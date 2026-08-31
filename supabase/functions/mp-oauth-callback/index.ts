// Callback do OAuth do Mercado Pago (MP Connect).
// O Mercado Pago redireciona o NAVEGADOR para cá com ?code=...&state=...
// Troca o code por tokens da conta da imobiliária, cifra e grava; depois
// devolve o navegador ao app com ?mp=conectado|erro.
// Deploy: PÚBLICO -> `supabase functions deploy mp-oauth-callback --no-verify-jwt`.
// Configurar MP_OAUTH_REDIRECT_URI = URL pública desta função.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { text } from "../_shared/security.ts";
import { encryptSecret } from "../_shared/crypto.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

function appBase(): string {
  return Deno.env.get("APP_URL_IMOB") || Deno.env.get("APP_URL") || "";
}

function redirectApp(ok: boolean, reason = "") {
  const base = appBase();
  let location = base;
  try {
    const u = new URL(base);
    // Volta para a tela da imobiliária; o app lê ?mp=... para dar o feedback.
    if (!u.pathname || u.pathname === "/") u.pathname = "/imobiliaria.html";
    u.searchParams.set("mp", ok ? "conectado" : "erro");
    if (reason) u.searchParams.set("mp_reason", reason);
    location = u.toString();
  } catch (_) { /* base inválida: cai no valor bruto */ }
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  const clientId = Deno.env.get("MP_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("MP_CLIENT_SECRET") ?? "";
  const redirectUri = Deno.env.get("MP_OAUTH_REDIRECT_URI") ?? "";
  const encKey = Deno.env.get("MP_TOKEN_ENC_KEY") ?? "";
  if (!admin || !clientId || !clientSecret || !redirectUri || !encKey || !appBase()) {
    return text("not configured", 503);
  }
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const err = url.searchParams.get("error") || "";
    if (err) return redirectApp(false, "negado");
    if (!code || !state) return redirectApp(false, "sem_code");

    // valida o state: existe, não usado e não expirado.
    const { data: st } = await admin.from("imob_mp_oauth_states")
      .select("imobiliaria_id, created_by, used_at, expires_at").eq("state", state).maybeSingle();
    if (!st || st.used_at || new Date(st.expires_at).getTime() < Date.now()) {
      return redirectApp(false, "state_invalido");
    }
    // marca usado imediatamente (anti-replay); se outra chamada já marcou, aborta.
    const { data: claimed, error: usedErr } = await admin.from("imob_mp_oauth_states")
      .update({ used_at: new Date().toISOString() }).eq("state", state).is("used_at", null).select("state");
    if (usedErr) throw usedErr;
    if (!claimed || !claimed.length) return redirectApp(false, "state_usado");

    // troca code -> tokens da conta da imobiliária
    const tokenResp = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResp.ok) {
      console.error("mp token exchange failed", tokenResp.status);
      return redirectApp(false, "token_falhou");
    }
    const tok = await tokenResp.json();
    if (!tok?.access_token) return redirectApp(false, "token_vazio");

    const accessEnc = await encryptSecret(String(tok.access_token));
    const refreshEnc = await encryptSecret(String(tok.refresh_token || ""));
    const expiresAt = tok.expires_in
      ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString()
      : null;

    const { error: upErr } = await admin.from("imobiliaria_mp_credenciais").upsert({
      imobiliaria_id: st.imobiliaria_id,
      mp_user_id: tok.user_id != null ? String(tok.user_id) : null,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      public_key: tok.public_key || null,
      scope: tok.scope || null,
      token_type: tok.token_type || null,
      live_mode: typeof tok.live_mode === "boolean" ? tok.live_mode : null,
      expires_at: expiresAt,
      status: "conectado",
      connected_by: st.created_by || null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: "imobiliaria_id" });
    if (upErr) throw upErr;

    return redirectApp(true);
  } catch (error) {
    console.error("mp-oauth-callback failed", error instanceof Error ? error.name : "unknown");
    return redirectApp(false, "erro");
  }
});
