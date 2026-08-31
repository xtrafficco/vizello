-- Vizello — Passo 2/4 (apoio): desconectar o Mercado Pago de uma imobiliária.
-- Marca a credencial como 'desconectado' e apaga os tokens cifrados.
-- Somente membros ativos da imobiliária. SECURITY DEFINER valida o tenant internamente.

begin;

create or replace function public.imob_mp_desconectar(p_imob uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from imobiliaria_membros m
    where m.imobiliaria_id = p_imob and m.user_id = auth.uid() and m.ativo
  ) then
    raise exception 'sem acesso a esta imobiliaria';
  end if;
  update imobiliaria_mp_credenciais
     set status = 'desconectado',
         access_token_enc = null,
         refresh_token_enc = null,
         updated_at = now()
   where imobiliaria_id = p_imob;
end $$;

revoke all on function public.imob_mp_desconectar(uuid) from public, anon;
grant execute on function public.imob_mp_desconectar(uuid) to authenticated;

commit;
