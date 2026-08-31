-- Vizello — Passo 3/4: cálculo de encargos por atraso do aluguel (fonte única).
-- Regra idêntica à do condomínio: multa fixa (%) + juros ao mês pró-rata por dia.
--   dias_atraso = max(0, hoje - vencimento - carência)
--   multa = base * multa_pct/100        (uma vez, quando em atraso)
--   juros = base * (juros_mes_pct/100) * dias_atraso/30   (pró-rata diária)
-- Override por locação (multa_pct/juros_mes_pct) tem precedência sobre o
-- default da imobiliária (cobranca_*). Se cobranca_ativa=false, não há encargo.

begin;

-- Núcleo do cálculo (SEM checagem de usuário). Só service_role executa.
create or replace function public.imob_aluguel_encargos_calc(p_lancamento uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  l record; im record; loc record;
  v_base numeric; v_multa_pct numeric; v_juros_pct numeric; v_car int;
  dias int; multa numeric; juros numeric;
begin
  select * into l from imob_lancamentos where id = p_lancamento;
  if not found then raise exception 'lancamento inexistente'; end if;

  select cobranca_ativa, cobranca_multa_pct, cobranca_juros_mes_pct, cobranca_carencia_dias
    into im from imobiliarias where id = l.imobiliaria_id;

  select multa_pct, juros_mes_pct into loc
    from locacoes
   where imovel_id = l.imovel_id and ativo
   order by created_at desc limit 1;

  v_base := coalesce(l.valor_base, l.valor);
  v_multa_pct := coalesce(loc.multa_pct, im.cobranca_multa_pct, 0);
  v_juros_pct := coalesce(loc.juros_mes_pct, im.cobranca_juros_mes_pct, 0);
  v_car := coalesce(im.cobranca_carencia_dias, 0);

  dias := 0;
  if l.vencimento is not null then
    dias := (current_date - l.vencimento) - v_car;
    if dias < 0 then dias := 0; end if;
  end if;

  if not coalesce(im.cobranca_ativa, false) or dias <= 0 then
    multa := 0; juros := 0;
  else
    multa := round(v_base * v_multa_pct / 100.0, 2);
    juros := round(v_base * (v_juros_pct / 100.0) * dias / 30.0, 2);
  end if;

  return jsonb_build_object(
    'valor_base', v_base,
    'multa', multa,
    'juros', juros,
    'dias_atraso', greatest(dias, 0),
    'total', round(v_base + multa + juros, 2),
    'multa_pct', v_multa_pct,
    'juros_mes_pct', v_juros_pct
  );
end $$;

revoke all on function public.imob_aluguel_encargos_calc(uuid) from public, anon, authenticated;
grant execute on function public.imob_aluguel_encargos_calc(uuid) to service_role;

-- Wrapper para o app (preview do valor com juros). Valida o membro da imobiliária.
create or replace function public.imob_aluguel_encargos(p_lancamento uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_imob uuid;
begin
  select imobiliaria_id into v_imob from imob_lancamentos where id = p_lancamento;
  if v_imob is null then raise exception 'lancamento inexistente'; end if;
  if not exists (
    select 1 from imobiliaria_membros m
    where m.imobiliaria_id = v_imob and m.user_id = auth.uid() and m.ativo
  ) then
    raise exception 'sem acesso a esta imobiliaria';
  end if;
  return public.imob_aluguel_encargos_calc(p_lancamento);
end $$;

revoke all on function public.imob_aluguel_encargos(uuid) from public, anon;
grant execute on function public.imob_aluguel_encargos(uuid) to authenticated;

commit;
