-- Vizello security baseline
-- Aplicar somente após revisar as policies de negócio em staging.
-- As tabelas de plataforma ficam acessíveis apenas por RPCs autorizadas ou
-- service_role; o cliente não deve consultar essas tabelas diretamente.

begin;

revoke all on table
  public.plataforma_cadastros,
  public.plataforma_checkout_pedidos,
  public.plataforma_plano_recursos
from anon, authenticated;

-- Mutations financeiras/administrativas nunca devem ser chamadas anonimamente.
revoke execute on function public.acordo_criar(uuid, uuid, uuid[], integer, date, numeric, text) from anon;
revoke execute on function public.fundo_excluir(uuid) from anon;
revoke execute on function public.fundo_lancar(uuid, text, numeric, text, date) from anon;

create table if not exists public.integration_webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('mercadopago_condominio', 'mercadopago_plataforma')),
  event_key text not null,
  request_id text,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed')),
  payload_hash text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  unique (source, event_key)
);

alter table public.integration_webhook_events enable row level security;
revoke all on table public.integration_webhook_events from anon, authenticated;
revoke all on table public.integration_webhook_events from public;
grant all on table public.integration_webhook_events to service_role;

create index if not exists integration_webhook_events_received_idx
  on public.integration_webhook_events (received_at desc);

commit;
