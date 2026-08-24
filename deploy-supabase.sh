#!/usr/bin/env bash
# =====================================================================
# VIZELLO — Deploy do backend no Supabase (Git Bash / Linux / macOS)
# Aplica as 2 migrations e faz o deploy da Edge Function feed-imoveis.
#
# Uso:
#   chmod +x deploy-supabase.sh
#   ./deploy-supabase.sh
#
# Requisitos: Supabase CLI instalado (https://supabase.com/docs/guides/cli).
#   - macOS:  brew install supabase/tap/supabase
#   - npm:    npm i -g supabase   (ou use SB="npx supabase")
# =====================================================================
set -euo pipefail
PROJECT_REF="bklvbhsaxcmrnjxjbzjh"
SB="supabase"   # troque para "npx supabase" se preferir sem instalar global

step(){ printf "\n==> %s\n" "$1"; }

step "Verificando Supabase CLI"
command -v ${SB%% *} >/dev/null 2>&1 || { echo "Supabase CLI nao encontrado. Instale e rode de novo."; exit 1; }
$SB --version

step "Login no Supabase (abre o navegador; se ja logado, pule com Ctrl+C)"
$SB login

step "Linkando o projeto $PROJECT_REF (pede a senha do banco 1x)"
$SB link --project-ref "$PROJECT_REF"

step "Aplicando migrations (db push)"
# PLANO B: se o push reclamar de historico divergente (o schema remoto foi criado
# fora desta pasta), pule este passo e cole os 2 arquivos de supabase/migrations/
# direto no Studio -> SQL Editor. O resultado e o mesmo.
$SB db push

step "Deploy da Edge Function feed-imoveis (--no-verify-jwt)"
$SB functions deploy feed-imoveis --no-verify-jwt --project-ref "$PROJECT_REF"

echo ""
echo "OK! Backend no ar."
echo "Feed publico: https://${PROJECT_REF}.supabase.co/functions/v1/feed-imoveis?imob=<ID_DA_IMOBILIARIA>"
echo ""
echo "Verificar no Studio -> SQL Editor:"
echo "  select jobname, schedule, active from cron.job where jobname='vizello-gerar-mensal';"
echo "  select public.cron_gerar_mensal();   -- roda 1x manualmente (opcional)"
echo ""
echo "Falta 1 passo manual: ativar 'Leaked Password Protection' em Authentication -> Policies."
