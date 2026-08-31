-- Vizello — Recebimento de aluguel na conta da própria imobiliária (Mercado Pago Connect)
-- Passo 1/4: base de schema.
--   - Credenciais OAuth do Mercado Pago por imobiliária (MP Connect)
--   - Estados de OAuth (CSRF)
--   - Configuração de encargos por atraso (multa/juros) por imobiliária e por locação
--   - Detalhamento financeiro da cobrança de aluguel (base/multa/juros/valor pago)
--   - Nova origem de webhook 'mercadopago_imobiliaria'
--   - RPC de status da conexão (sem expor tokens)
--
-- Todas as alterações são ADITIVAS: não removem colunas nem dados existentes.
-- Aplicar após revisar em staging (segue o mesmo padrão do baseline de segurança).

begin;

-- ---------------------------------------------------------------------------
-- 1) Credenciais Mercado Pago por imobiliária (OAuth / MP Connect).
--    Os tokens são gravados JÁ CRIPTOGRAFADOS pela edge function (AES-GCM);
--    o banco nunca armazena o token em texto puro. Acesso somente por
--    service_role, igual às tabelas de plataforma do baseline.
-- ---------------------------------------------------------------------------
create table if not exists public.imobiliaria_mp_credenciais (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null unique references public.imobiliarias(id) on delete cascade,
  mp_user_id text,                 -- collector_id do Mercado Pago (público)
  access_token_enc text,           -- ciphertext (AES-GCM)
  refresh_token_enc text,          -- ciphertext (AES-GCM)
  public_key text,
  scope text,
  token_type text,
  live_mode boolean,
  expires_at timestamptz,
  status text not null default 'conectado' check (status in ('conectado','desconectado','erro')),
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text
);

alter table public.imobiliaria_mp_credenciais enable row level security;
revoke all on table public.imobiliaria_mp_credenciais from anon, authenticated, public;
grant all on table public.imobiliaria_mp_credenciais to service_role;

-- ---------------------------------------------------------------------------
-- 2) Estados de OAuth (proteção CSRF do fluxo de autorização).
-- ---------------------------------------------------------------------------
create table if not exists public.imob_mp_oauth_states (
  state text primary key,
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz
);

alter table public.imob_mp_oauth_states enable row level security;
revoke all on table public.imob_mp_oauth_states from anon, authenticated, public;
grant all on table public.imob_mp_oauth_states to service_role;

create index if not exists imob_mp_oauth_states_imob_idx
  on public.imob_mp_oauth_states (imobiliaria_id);

-- ---------------------------------------------------------------------------
-- 3) Configuração de encargos por atraso.
--    Default por imobiliária; override opcional por locação (nulo = usa o default).
-- ---------------------------------------------------------------------------
alter table public.imobiliarias
  add column if not exists cobranca_ativa boolean not null default false,
  add column if not exists cobranca_multa_pct numeric not null default 0,
  add column if not exists cobranca_juros_mes_pct numeric not null default 0,
  add column if not exists cobranca_carencia_dias integer not null default 0;

alter table public.locacoes
  add column if not exists multa_pct numeric,
  add column if not exists juros_mes_pct numeric;

-- ---------------------------------------------------------------------------
-- 4) Detalhamento financeiro da cobrança de aluguel.
--    valor         = valor_base + multa + juros (total cobrado)
--    valor_pago    = valor efetivamente recebido (confirmado pelo webhook)
-- ---------------------------------------------------------------------------
alter table public.imob_lancamentos
  add column if not exists valor_base numeric,
  add column if not exists multa numeric not null default 0,
  add column if not exists juros numeric not null default 0,
  add column if not exists dias_atraso integer,
  add column if not exists valor_pago numeric,
  add column if not exists mp_payment_id text;

-- ---------------------------------------------------------------------------
-- 5) Nova origem de webhook para o aluguel da imobiliária.
-- ---------------------------------------------------------------------------
alter table public.integration_webhook_events
  drop constraint if exists integration_webhook_events_source_check;
alter table public.integration_webhook_events
  add constraint integration_webhook_events_source_check
  check (source in ('mercadopago_condominio','mercadopago_plataforma','mercadopago_imobiliaria'));

-- ---------------------------------------------------------------------------
-- 6) Status da conexão MP para a UI (nunca expõe tokens).
--    Somente membros ativos da imobiliária.
-- ---------------------------------------------------------------------------
create or replace function public.imob_mp_status(p_imob uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare r record;
begin
  if not exists (
    select 1 from imobiliaria_membros m
    where m.imobiliaria_id = p_imob and m.user_id = auth.uid() and m.ativo
  ) then
    raise exception 'sem acesso a esta imobiliaria';
  end if;
  select status, mp_user_id, connected_at, expires_at, live_mode
    into r
  from imobiliaria_mp_credenciais
  where imobiliaria_id = p_imob;
  if not found then
    return jsonb_build_object('conectado', false);
  end if;
  return jsonb_build_object(
    'conectado', r.status = 'conectado',
    'status', r.status,
    'mp_user_id', r.mp_user_id,
    'connected_at', r.connected_at,
    'expires_at', r.expires_at,
    'live_mode', r.live_mode
  );
end $$;

revoke all on function public.imob_mp_status(uuid) from public, anon;
grant execute on function public.imob_mp_status(uuid) to authenticated;

commit;
