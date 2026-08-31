-- Vizello — Passo 4/4: relatório de aluguéis (recebidos, não recebidos, juros pagos).
-- Agrega imob_lancamentos de aluguel por período (filtrado pelo vencimento).
-- Somente membros ativos da imobiliária.

begin;

create or replace function public.imob_aluguel_relatorio(p_imob uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_tot jsonb; v_rows jsonb;
begin
  if not exists (
    select 1 from imobiliaria_membros m
    where m.imobiliaria_id = p_imob and m.user_id = auth.uid() and m.ativo
  ) then
    raise exception 'sem acesso a esta imobiliaria';
  end if;

  select jsonb_build_object(
    'recebidos_qtd', count(*) filter (where status='pago'),
    'recebidos_valor', coalesce(sum(coalesce(valor_pago,valor)) filter (where status='pago'),0),
    'juros_pagos', coalesce(sum(juros) filter (where status='pago'),0),
    'multa_paga', coalesce(sum(multa) filter (where status='pago'),0),
    'areceber_qtd', count(*) filter (where status='pendente'),
    'areceber_valor', coalesce(sum(valor) filter (where status='pendente'),0),
    'vencidos_qtd', count(*) filter (where status='pendente' and vencimento < current_date),
    'vencidos_valor', coalesce(sum(valor) filter (where status='pendente' and vencimento < current_date),0),
    'base_total', coalesce(sum(coalesce(valor_base,valor)),0)
  ) into v_tot
  from imob_lancamentos
  where imobiliaria_id = p_imob and categoria='aluguel' and tipo='receita'
    and vencimento between p_de and p_ate;

  select coalesce(jsonb_agg(r order by r_venc desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', l.id, 'imovel', i.titulo, 'competencia', l.competencia,
      'vencimento', l.vencimento, 'status', l.status,
      'valor_base', coalesce(l.valor_base,l.valor), 'multa', l.multa, 'juros', l.juros,
      'valor', l.valor, 'valor_pago', l.valor_pago, 'pago_em', l.pago_em,
      'dias_atraso', l.dias_atraso, 'gateway', l.gateway,
      'vencido', (l.status='pendente' and l.vencimento < current_date)
    ) as r, l.vencimento as r_venc
    from imob_lancamentos l
    left join imoveis i on i.id = l.imovel_id
    where l.imobiliaria_id = p_imob and l.categoria='aluguel' and l.tipo='receita'
      and l.vencimento between p_de and p_ate
    order by l.vencimento desc
    limit 500
  ) s;

  return jsonb_build_object('totais', v_tot, 'itens', v_rows);
end $$;

revoke all on function public.imob_aluguel_relatorio(uuid, date, date) from public, anon;
grant execute on function public.imob_aluguel_relatorio(uuid, date, date) to authenticated;

commit;
