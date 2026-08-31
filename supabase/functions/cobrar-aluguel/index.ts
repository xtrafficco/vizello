// Gera a cobrança de aluguel (PIX dinâmico) NA CONTA DA PRÓPRIA IMOBILIÁRIA.
// O valor já inclui multa + juros do dia (regra em imob_aluguel_encargos_calc).
// Chamada pelo app: supabase.functions.invoke("cobrar-aluguel", { body:{ lancamento_id } }).
// Deploy: JWT obrigatório (padrão).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { json, text, readJson } from "../_shared/security.ts";
import { getUserFromRequest, isImobMember } from "../_shared/auth.ts";
import { decryptSecret } from "../_shared/crypto.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  const webhookUrl = Deno.env.get("MP_ALUGUEL_WEBHOOK_URL") ?? "";
  if (!admin || !webhookUrl || !Deno.env.get("MP_TOKEN_ENC_KEY")) return text("not configured", 503);
  try {
    const user = await getUserFromRequest(req);
    if (!user) return text("unauthorized", 401);

    const body = await readJson(req);
    const lancId = String(body?.lancamento_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(lancId)) return json({ error: "lancamento_id inválido" }, 400);

    // Lançamento (deve ser aluguel a receber, ainda pendente).
    const { data: l } = await admin.from("imob_lancamentos")
      .select("id, imobiliaria_id, imovel_id, tipo, categoria, status, valor, competencia, descricao")
      .eq("id", lancId).maybeSingle();
    if (!l) return json({ error: "lançamento não encontrado" }, 404);
    if (!(await isImobMember(admin, l.imobiliaria_id, user.id))) return text("forbidden", 403);
    if (l.tipo !== "receita" || l.categoria !== "aluguel") return json({ error: "não é uma cobrança de aluguel" }, 400);
    if (l.status === "pago") return json({ error: "esta cobrança já está paga" }, 409);

    // Credenciais Mercado Pago da imobiliária.
    const { data: cred } = await admin.from("imobiliaria_mp_credenciais")
      .select("access_token_enc, status").eq("imobiliaria_id", l.imobiliaria_id).maybeSingle();
    if (!cred || cred.status !== "conectado" || !cred.access_token_enc) {
      return json({ error: "Mercado Pago não conectado para esta imobiliária" }, 409);
    }
    const token = await decryptSecret(cred.access_token_enc);
    if (!token) return json({ error: "credencial inválida" }, 409);

    // Valor com encargos (fonte única no banco).
    const { data: enc, error: encErr } = await admin.rpc("imob_aluguel_encargos_calc", { p_lancamento: lancId });
    if (encErr || !enc) throw encErr || new Error("cálculo de encargos falhou");
    const total = Number(enc.total || 0);
    if (!(total > 0)) return json({ error: "valor inválido para cobrança" }, 400);

    // E-mail do pagador (obrigatório no MP): locatário → imobiliária → genérico.
    let payerEmail = "";
    const { data: loc } = await admin.from("locacoes")
      .select("locatario_email").eq("imovel_id", l.imovel_id).eq("ativo", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    payerEmail = (loc?.locatario_email || "").trim();
    if (!payerEmail) {
      const { data: imob } = await admin.from("imobiliarias").select("email").eq("id", l.imobiliaria_id).maybeSingle();
      payerEmail = (imob?.email || "").trim();
    }
    if (!payerEmail) payerEmail = "pagador@vizello.app";

    // Cria o pagamento PIX na conta da imobiliária.
    const descricao = ("Aluguel " + (l.competencia || "") + (l.descricao ? " · " + l.descricao : "")).trim().slice(0, 250);
    const mpResp = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": lancId + ":" + new Date().toISOString().slice(0, 10) + ":" + total,
      },
      body: JSON.stringify({
        transaction_amount: total,
        description: descricao || "Aluguel",
        payment_method_id: "pix",
        external_reference: lancId,
        notification_url: webhookUrl,
        payer: { email: payerEmail },
      }),
    });
    const mp = await mpResp.json().catch(() => ({}));
    if (!mpResp.ok || !mp?.id) {
      console.error("mp payment failed", mpResp.status, mp?.message || "");
      return json({ error: "Não foi possível gerar a cobrança no Mercado Pago." }, 502);
    }
    const tdata = mp?.point_of_interaction?.transaction_data || {};
    const qr = tdata.qr_code || "";
    const qr64 = tdata.qr_code_base64 || "";

    // Grava o detalhamento na cobrança.
    const { error: upErr } = await admin.from("imob_lancamentos").update({
      valor_base: Number(enc.valor_base),
      multa: Number(enc.multa),
      juros: Number(enc.juros),
      dias_atraso: Number(enc.dias_atraso),
      valor: total,
      mp_payment_id: String(mp.id),
      cobranca_ref: String(mp.id),
      gateway: "mercadopago",
      metodo: "pix",
      pix_copiacola: qr || null,
    }).eq("id", lancId);
    if (upErr) throw upErr;

    return json({
      qr_code: qr,
      qr_code_base64: qr64,
      total,
      valor_base: Number(enc.valor_base),
      multa: Number(enc.multa),
      juros: Number(enc.juros),
      dias_atraso: Number(enc.dias_atraso),
      payment_id: String(mp.id),
    });
  } catch (error) {
    console.error("cobrar-aluguel failed", error instanceof Error ? error.name : "unknown");
    return text("error", 500);
  }
});
