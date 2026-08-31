// Webhook do Mercado Pago para o ALUGUEL da imobiliária (baixa automática).
// O pagamento cai na conta da imobiliária; aqui só confirmamos e damos baixa.
// Deploy: PÚBLICO -> `supabase functions deploy mp-aluguel-webhook --no-verify-jwt`.
// Configurar a assinatura do webhook (app-level) em MP_ALUGUEL_WEBHOOK_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { constantTimeEqual, hmacHex, json, parseSignature, text, timestampFresh, readJson } from "../_shared/security.ts";
import { decryptSecret } from "../_shared/crypto.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

async function claim(client: any, eventKey: string, requestId: string) {
  const { data: current } = await client.from("integration_webhook_events").select("status,processed_at")
    .eq("source", "mercadopago_imobiliaria").eq("event_key", eventKey).maybeSingle();
  if (current?.processed_at || current?.status === "processed") return false;
  if (!current) {
    const { error } = await client.from("integration_webhook_events").insert({
      source: "mercadopago_imobiliaria", event_key: eventKey, request_id: requestId, status: "processing",
    });
    if (error?.code === "23505") return false;
    if (error) throw error;
  } else {
    const { error } = await client.from("integration_webhook_events")
      .update({ status: "processing", request_id: requestId })
      .eq("source", "mercadopago_imobiliaria").eq("event_key", eventKey);
    if (error) throw error;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  const secret = Deno.env.get("MP_ALUGUEL_WEBHOOK_SECRET") ?? "";
  if (!secret || !admin || !Deno.env.get("MP_TOKEN_ENC_KEY")) return text("not configured", 503);
  try {
    const url = new URL(req.url);
    const body = await readJson(req);
    const dataId = String(url.searchParams.get("data.id") || body?.data?.id || url.searchParams.get("id") || "");
    const topic = url.searchParams.get("type") || url.searchParams.get("topic") || body?.type;
    const requestId = req.headers.get("x-request-id") || "";
    const signature = parseSignature(req.headers.get("x-signature") || "");
    if (!/^\d{1,30}$/.test(dataId) || !requestId || !signature.ts || !signature.v1 || !timestampFresh(signature.ts)) {
      return text("bad request", 401);
    }
    const manifest = "id:" + dataId.toLowerCase() + ";request-id:" + requestId + ";ts:" + signature.ts + ";";
    if (!constantTimeEqual(await hmacHex(secret, manifest), signature.v1.toLowerCase())) return text("unauthorized", 401);
    if (topic && topic !== "payment") return json({ status: "ignored" });

    const eventKey = "payment:" + dataId;
    if (!await claim(admin, eventKey, requestId)) return json({ status: "duplicate" });

    // Resolve o lançamento pela cobrança gerada.
    const { data: lanc } = await admin.from("imob_lancamentos")
      .select("id, imobiliaria_id, status").eq("mp_payment_id", dataId).maybeSingle();

    if (lanc && lanc.status !== "pago") {
      // Busca autoritativa do pagamento com o token da PRÓPRIA imobiliária.
      const { data: cred } = await admin.from("imobiliaria_mp_credenciais")
        .select("access_token_enc").eq("imobiliaria_id", lanc.imobiliaria_id).maybeSingle();
      const token = cred?.access_token_enc ? await decryptSecret(cred.access_token_enc) : "";
      if (token) {
        const payResp = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(dataId), {
          headers: { Authorization: "Bearer " + token },
        });
        if (!payResp.ok) throw new Error("payment lookup failed");
        const payment = await payResp.json();
        if (payment?.status === "approved" && String(payment?.external_reference || "") === lanc.id) {
          const { error } = await admin.from("imob_lancamentos")
            .update({ status: "pago", pago_em: new Date().toISOString(), valor_pago: Number(payment.transaction_amount) })
            .eq("id", lanc.id).neq("status", "pago");
          if (error) throw error;
        }
      }
    }

    const { error } = await admin.from("integration_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("source", "mercadopago_imobiliaria").eq("event_key", eventKey);
    if (error) throw error;
    return json({ status: "processed" });
  } catch (error) {
    console.error("mp-aluguel-webhook failed", error instanceof Error ? error.name : "unknown");
    return text("retry later", 500);
  }
});
