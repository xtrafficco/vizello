// Renova os tokens OAuth do Mercado Pago das imobiliárias antes de expirarem
// (os tokens do MP expiram em ~180 dias). Acionada pelo cron via pg_net.
// Protegida por header x-refresh-key == MP_REFRESH_CRON_SECRET (não usa JWT).
// Deploy: `supabase functions deploy mp-oauth-refresh --no-verify-jwt`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { constantTimeEqual, json, text } from "../_shared/security.ts";
import { encryptSecret, decryptSecret } from "../_shared/crypto.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

// Renova as que expiram nos próximos N dias (ou sem expiração conhecida).
const JANELA_DIAS = 15;
const LOTE = 200;

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  const cronSecret = Deno.env.get("MP_REFRESH_CRON_SECRET") ?? "";
  const clientId = Deno.env.get("MP_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("MP_CLIENT_SECRET") ?? "";
  if (!admin || !cronSecret || !clientId || !clientSecret || !Deno.env.get("MP_TOKEN_ENC_KEY")) {
    return text("not configured", 503);
  }
  // Autenticação do cron (compara em tempo constante).
  const provided = req.headers.get("x-refresh-key") || "";
  if (!constantTimeEqual(provided, cronSecret)) return text("unauthorized", 401);

  try {
    const limite = new Date(Date.now() + JANELA_DIAS * 24 * 3600 * 1000).toISOString();
    const { data: creds, error } = await admin.from("imobiliaria_mp_credenciais")
      .select("imobiliaria_id, refresh_token_enc, expires_at")
      .eq("status", "conectado")
      .not("refresh_token_enc", "is", null)
      .or("expires_at.is.null,expires_at.lt." + limite)
      .limit(LOTE);
    if (error) throw error;

    let refreshed = 0, failed = 0;
    for (const c of (creds || [])) {
      try {
        const refreshToken = await decryptSecret(c.refresh_token_enc);
        if (!refreshToken) { failed++; continue; }
        const resp = await fetch("https://api.mercadopago.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
          }),
        });
        const tok = await resp.json().catch(() => ({}));
        if (!resp.ok || !tok?.access_token) {
          failed++;
          await admin.from("imobiliaria_mp_credenciais")
            .update({ status: "erro", last_error: "refresh falhou (" + resp.status + ")", updated_at: new Date().toISOString() })
            .eq("imobiliaria_id", c.imobiliaria_id);
          continue;
        }
        const accessEnc = await encryptSecret(String(tok.access_token));
        const refreshEnc = tok.refresh_token ? await encryptSecret(String(tok.refresh_token)) : c.refresh_token_enc;
        const expiresAt = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString() : null;
        await admin.from("imobiliaria_mp_credenciais").update({
          access_token_enc: accessEnc,
          refresh_token_enc: refreshEnc,
          scope: tok.scope || null,
          token_type: tok.token_type || null,
          live_mode: typeof tok.live_mode === "boolean" ? tok.live_mode : null,
          expires_at: expiresAt,
          status: "conectado",
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("imobiliaria_id", c.imobiliaria_id);
        refreshed++;
      } catch (_) {
        failed++;
      }
    }
    return json({ status: "ok", refreshed, failed, avaliadas: (creds || []).length });
  } catch (error) {
    console.error("mp-oauth-refresh failed", error instanceof Error ? error.name : "unknown");
    return text("error", 500);
  }
});
