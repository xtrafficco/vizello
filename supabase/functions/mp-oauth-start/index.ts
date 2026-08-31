// Inicia o fluxo OAuth do Mercado Pago (MP Connect) para uma imobiliária.
// Chamada pelo app autenticado: supabase.functions.invoke("mp-oauth-start", { body:{ imobiliaria_id } }).
// Retorna { url } — o app redireciona o navegador para essa URL de autorização.
// Deploy: JWT obrigatório (padrão). NÃO usar --no-verify-jwt aqui.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { json, text, readJson } from "../_shared/security.ts";
import { getUserFromRequest, isImobMember } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = supabaseUrl && serviceRole ? createClient(supabaseUrl, serviceRole) : null;

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("method not allowed", 405);
  const clientId = Deno.env.get("MP_CLIENT_ID") ?? "";
  const redirectUri = Deno.env.get("MP_OAUTH_REDIRECT_URI") ?? "";
  if (!clientId || !redirectUri || !admin) return text("not configured", 503);
  try {
    const user = await getUserFromRequest(req);
    if (!user) return text("unauthorized", 401);

    const body = await readJson(req);
    const imobId = String(body?.imobiliaria_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(imobId)) return json({ error: "imobiliaria_id inválido" }, 400);

    if (!(await isImobMember(admin, imobId, user.id))) return text("forbidden", 403);

    // state anti-CSRF: aleatório, guardado com a imobiliária e expiração curta.
    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const { error } = await admin.from("imob_mp_oauth_states")
      .insert({ state, imobiliaria_id: imobId, created_by: user.id });
    if (error) throw error;

    const authUrl = new URL("https://auth.mercadopago.com/authorization");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("platform_id", "mp");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    return json({ url: authUrl.toString() });
  } catch (error) {
    console.error("mp-oauth-start failed", error instanceof Error ? error.name : "unknown");
    return text("error", 500);
  }
});
