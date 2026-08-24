# Checklist de deploy — melhorias frontend + backend

> Tudo abaixo já está **pronto no repositório**. A parte de banco/edge não pôde
> ser aplicada automaticamente aqui (a trava de segurança do Claude Code bloqueia
> escrita no Supabase de produção). Aplique com um dos métodos indicados.

---

## ✅ 1. Frontend — só publicar os arquivos estáticos

- **Leaflet auto-hospedado** em `vendor/leaflet/` (js, css, ícones). `imobiliaria.html`
  e `admin.html` agora usam `/vendor/leaflet/…` (sem `unpkg.com`). Funciona offline.
- **Zoom liberado** (acessibilidade): removido `maximum-scale=1, user-scalable=no`
  de `admin.html`, `condominio.html`, `imobiliaria.html`.
- **Service worker** `sw.js` → cache `condoapp-v19`; pré-cacheia o app da imobiliária
  e o Leaflet local.
- **`index.html`** virou stub de redirecionamento (era duplicata de 256 KB de
  `site.html`, o arquivo canônico servido em `/`).
- **Tela de Anúncios da imobiliária** agora mostra a **URL pública do feed** pronta
  para colar no ZAP/OLX (botões abrir/copiar), em vez do aviso "falta ligar".

**Publicar** = subir os estáticos (Vercel/Netlify). O SW novo (v19) troca o antigo
sozinho no próximo acesso.

---

## ⏳ 2. Banco — 2 migrations prontas em `supabase/migrations/`

Aplicar com **Supabase Studio → SQL Editor** (colar e Run) ou **CLI** (`supabase db push`).

### `20260824111354_perf_fk_indexes_rls_initplan_anon_revoke.sql`
Seguro, idempotente, sem downtime:
1. 17 índices de cobertura para foreign keys.
2. 3 políticas RLS reescritas com `(select auth.uid())` (initplan).
3. `REVOKE EXECUTE ... FROM anon` em 5 RPCs que exigem login.

### `20260824111500_cron_geracao_mensal.sql`  ⚠️ revisar antes
Automatiza a geração mensal (todo dia 1, 06:00 BRT) via **pg_cron** (já instalado):
- aluguéis por imobiliária, despesas e cobranças recorrentes por condomínio,
  despesas internas e faturas de mensalidade da plataforma.
- Torna o *guard* de 3 funções "system-aware" (só exige papel quando há usuário
  logado — seguro, pois nenhuma é executável por `anon`). Cria `cron_gerar_mensal()`
  e agenda o job `vizello-gerar-mensal`.
- Como altera funções financeiras, **revise o SQL** antes de aplicar.
- Conferir depois: `select * from cron.job;`  e rodar 1x manual: `select cron_gerar_mensal();`

> Depois de aplicar as duas, reexecutar os *advisors* (Studio → Advisors) deve
> zerar os índices de FK e o initplan.

---

## 🚀 3. Edge Function `feed-imoveis` — pronta em `supabase/functions/feed-imoveis/`

Completa o recurso de Anúncios (feed XML público VRSync para ZAP/VivaReal/OLX).

**Deploy:** `supabase functions deploy feed-imoveis --no-verify-jwt`
(precisa ser público — os portais não enviam JWT). Usa `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` (injetadas automaticamente).

URL final: `https://bklvbhsaxcmrnjxjbzjh.supabase.co/functions/v1/feed-imoveis?imob=<ID>`
(a tela de Anúncios já exibe a URL certa por imobiliária).

---

## 🔧 4. Ação manual no Dashboard (não há SQL)

**Ativar "Leaked Password Protection"**: Authentication → Policies (Password) → ativar.
Bloqueia senhas de vazamentos conhecidos (HaveIBeenPwned).

---

## Como deixar o Claude aplicar isto automaticamente (opcional)

A trava que bloqueou o deploy/migração é do modo automático do Claude Code. Para
autorizar, adicione uma regra de permissão nas configurações (settings) para as
ferramentas do Supabase MCP, ou rode numa sessão interativa aprovando a ação.
Feito isso, posso aplicar as 2 migrations e o deploy e reexecutar os advisors.
