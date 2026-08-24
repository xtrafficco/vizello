# =====================================================================
# VIZELLO — Deploy do backend no Supabase (Windows / PowerShell)
# Aplica as 2 migrations e faz o deploy da Edge Function feed-imoveis.
#
# Uso:
#   1) Abra o PowerShell nesta pasta (vizello-main)
#   2) Execute:  .\deploy-supabase.ps1
#      (se bloquear por policy:  powershell -ExecutionPolicy Bypass -File .\deploy-supabase.ps1)
#
# Requisitos: Supabase CLI instalado.  Instale com uma opção:
#   - scoop install supabase
#   - npm i -g supabase   (ou use  npx supabase ...  ajustando $SB abaixo)
# =====================================================================
$ErrorActionPreference = "Stop"
$PROJECT_REF = "bklvbhsaxcmrnjxjbzjh"
$SB = "supabase"   # troque para "npx supabase" se preferir sem instalar global

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# 0) Confere CLI
Step "Verificando Supabase CLI"
try { & $SB --version } catch { Write-Error "Supabase CLI nao encontrado. Instale (scoop install supabase) e rode de novo."; exit 1 }

# 1) Login (abre o navegador; pule se ja estiver logado)
Step "Login no Supabase (Enter abre o navegador; se ja logado, Ctrl+C e comente esta linha)"
& $SB login

# 2) Linka o projeto (pede a senha do banco 1x)
Step "Linkando o projeto $PROJECT_REF"
& $SB link --project-ref $PROJECT_REF

# 3) Aplica as migrations (supabase/migrations/*.sql)
# PLANO B: se o push reclamar de historico divergente (o schema remoto foi criado
# fora desta pasta), pule este passo e cole os 2 arquivos de supabase\migrations\
# direto no Studio -> SQL Editor. O resultado e o mesmo.
Step "Aplicando migrations (db push)"
& $SB db push

# 4) Deploy da Edge Function feed-imoveis (publica, sem JWT)
Step "Deploy da Edge Function feed-imoveis (--no-verify-jwt)"
& $SB functions deploy feed-imoveis --no-verify-jwt --project-ref $PROJECT_REF

Write-Host "`nOK! Backend no ar." -ForegroundColor Green
Write-Host "Feed publico: https://$PROJECT_REF.supabase.co/functions/v1/feed-imoveis?imob=<ID_DA_IMOBILIARIA>"
Write-Host ""
Write-Host "Verificar no Studio -> SQL Editor:"
Write-Host "  select jobname, schedule, active from cron.job where jobname='vizello-gerar-mensal';"
Write-Host "  select public.cron_gerar_mensal();   -- roda 1x manualmente (opcional)"
Write-Host ""
Write-Host "Falta 1 passo manual: ativar 'Leaked Password Protection' em Authentication -> Policies."
