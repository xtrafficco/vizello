import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { constantTimeEqual, hmacHex, json, parseSignature, text, timestampFresh, readJson } from "../_shared/security.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

async function claim(client: any, eventKey: string, requestId: string) {
  const { data: current } = await client.from("integration_webhook_events").select("status,processed_at")
    .eq("source", "mercadopago_condominio").eq("event_key", eventKey).maybeSingle();
  if (current?.processed_at || current?.status === "processed") return false;
  if (!current) {
    const { error } = await client.from("integration_webhook_events").insert({
      source: "mercadopago_condominio", event_key: eventKey, request_id: requestId, status: "processing",
    });
    if (error?.code === "23505") return false;
    if (error) throw error;
  } else {
    const { error } = await client.from("integration_webhook_events")
      .update({ status: "processing", request_id: requestId })
      .eq("source", "mercadopago_condominio").eq("event_key", eventKey);
    if (error) throw error;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  const token = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
  const secret = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
  if (!token || !secret || !admin) return text("not configured", 503);
  try {
    const url = new URL(req.url);
    const body = await readJson(req);
    const dataId = String(url.searchParams.get("data.id") || body?.data?.id || url.searchParams.get("id") || "");
    const topic = url.searchParams.get("type") || url.searchParams.get("topic") || body?.type;
    const requestId = req.headers.get("x-request-id") || "";
    const signature = parseSignature(req.headers.get("x-signature") || "");
    if (!/^\d{1,30}$/.test(dataId) || !requestId || !signature.ts || !signature.v1 || !timestampFresh(signature.ts)) return text("bad request", 401);
    const manifest = "id:" + dataId.toLowerCase() + ";request-id:" + requestId + ";ts:" + signature.ts + ";";
    if (!constantTimeEqual(await hmacHex(secret, manifest), signature.v1.toLowerCase())) return text("unauthorized", 401);
    if (topic && topic !== "payment") return json({ status: "ignored" });
    const eventKey = "payment:" + dataId;
    if (!await claim(admin, eventKey, requestId)) return json({ status: "duplicate" });
    const paymentResponse = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(dataId), {
      headers: { Authorization: "Bearer " + token },
    });
    if (!paymentResponse.ok) throw new Error("payment lookup failed");
    const payment = await paymentResponse.json();
    const chargeId = String(payment?.external_reference || "");
    if (payment?.status === "approved" && /^[0-9a-f-]{36}$/i.test(chargeId)) {
      const { error } = await admin.from("cobrancas").update({ status: "paga", pago_em: new Date().toISOString() })
        .eq("id", chargeId).eq("status", "aberta");
      if (error) throw error;
    }
    const { error } = await admin.from("integration_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("source", "mercadopago_condominio").eq("event_key", eventKey);
    if (error) throw error;
    return json({ status: "processed" });
  } catch (error) {
    console.error("payment webhook failed", error instanceof Error ? error.name : "unknown");
    return text("retry later", 500);
  }
});
