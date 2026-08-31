-- Vizello — Refresh automático dos tokens OAuth do Mercado Pago das imobiliárias.
-- Os tokens do MP expiram em ~180 dias. Um cron diário aciona (via pg_net) a
-- edge function mp-oauth-refresh, que renova as credenciais próximas de expirar.
--
-- Config necessária (uma vez, no banco), com a chave do cron:
--   alter database postgres set app.settings.mp_refresh_key = '<MP_REFRESH_CRON_SECRET>';
-- O mesmo valor vai no secret MP_REFRESH_CRON_SECRET da edge function.

begin;

create or replace function public.cron_mp_refresh()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_url text := 'https://bklvbhsaxcmrnjxjbzjh.supabase.co/functions/v1/mp-oauth-refresh';
begin
  v_key := current_setting('app.settings.mp_refresh_key', true);
  if v_key is null or v_key = '' then
    raise notice 'cron_mp_refresh: app.settings.mp_refresh_key não configurada; ignorando.';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-refresh-key', v_key),
    body := '{}'::jsonb
  );
end $$;

revoke all on function public.cron_mp_refresh() from public, anon, authenticated;

-- Agenda diária às 03:20 (UTC). Seguro rodar mesmo sem config (no-op).
select cron.schedule('mp-oauth-refresh', '20 3 * * *', $$ select public.cron_mp_refresh(); $$);

commit;
