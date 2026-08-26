# Checklist de hardening do backend

O projeto remoto `CONDOAPP` está ativo e saudável no Supabase (Postgres 17.6).
O schema foi inspecionado em 26/08/2026; todas as tabelas públicas listadas estão
com RLS habilitado. As correções abaixo devem ser aplicadas em uma migration
versionada, após revisão do acesso esperado de cada fluxo.

## Diagnóstico remoto atual

- Três tabelas têm RLS sem nenhuma policy: `plataforma_cadastros`,
  `plataforma_checkout_pedidos` e `plataforma_plano_recursos`.
- O Advisor encontrou 9 funções `SECURITY DEFINER` executáveis por `anon` e
  222 executáveis por `authenticated`; cada uma precisa de revisão individual
  antes de revogar o grant, pois algumas são chamadas pelos portais.
- Há um aviso de proteção contra senhas comprometidas desativada no Auth.
- O Advisor de performance encontrou 21 foreign keys sem índice de cobertura e
  3 policies de imobiliária que devem trocar `auth.uid()` por
  `(select auth.uid())` para evitar reavaliação por linha.
- Há 88 índices sem uso registrados como informação; não removê-los sem medir
  carga real e consultar o caminho de leitura correspondente.

A primeira tentativa de aplicar SQL diretamente foi interrompida pelo limite de
uso do agente antes da execução. Nenhuma alteração remota foi feita nesta
rodada.

## Segurança de dados

- Ativar RLS em todas as tabelas expostas pelo Data API.
- Conferir que cada policy usa ownership real (usuário, membership, condomínio
  ou imobiliária), e não apenas `TO authenticated`.
- Em `UPDATE`, revisar sempre `USING` e `WITH CHECK` para impedir reatribuição
  de `condominio_id`, `imobiliaria_id`, `user_id` ou papéis.
- Em views, usar `security_invoker = true` ou revogar acesso às views que não
  devem ser públicas.
- Revisar todas as funções `SECURITY DEFINER`: checar `auth.uid()`, search path,
  argumentos e grants explícitos. Remover `EXECUTE` de `PUBLIC` quando aplicável.
- Revisar policies dos buckets `anexos`, `documentos` e `imob-docs`, incluindo
  limite de tamanho, MIME permitido e isolamento por tenant.

## Integridade transacional

- Transformar fluxos de várias gravações em RPCs transacionais no servidor:
  locação + status do imóvel, abertura de chamado + primeira mensagem,
  vistoria + itens e operações de cobrança.
- Adicionar constraints para status, valores não negativos, datas válidas,
  unicidade de locação ativa por imóvel e referências entre tenants.
- Tornar geração de faturas, checkout e webhooks idempotentes.
- Validar no servidor todos os valores recebidos do cliente; o frontend não é
  uma fronteira de autorização.

## Operação

- Executar Supabase Advisors de segurança e performance após cada migration.
- Criar testes de autorização com usuário sem vínculo, usuário de outro tenant,
  operador sem permissão e usuário anônimo.
- Monitorar falhas de RPC, Edge Functions, Auth, Storage e Realtime.
- Manter migrations e Edge Functions em repositório versionado separado e
  publicar o frontend somente quando o contrato de backend estiver compatível.
