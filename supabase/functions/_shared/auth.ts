// Identidade do usuário a partir do JWT enviado pelo app (Authorization: Bearer).
// Usado pelas funções chamadas via supabase.functions.invoke (ex.: iniciar OAuth,
// gerar cobrança de aluguel). Webhooks públicos NÃO usam isto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export interface RequestUser {
  id: string;
}

export async function getUserFromRequest(req: Request): Promise<RequestUser | null> {
  const authz = req.headers.get("Authorization") || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return null;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id };
}

// Confirma que o usuário é membro ATIVO da imobiliária. Usa service_role
// (admin) para consultar imobiliaria_membros sem depender de RLS.
export async function isImobMember(admin: any, imobId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("imobiliaria_membros")
    .select("papel")
    .eq("imobiliaria_id", imobId)
    .eq("user_id", userId)
    .eq("ativo", true)
    .maybeSingle();
  return !!data;
}
