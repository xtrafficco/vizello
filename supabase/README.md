# Backend de segurança do Vizello

Este diretório versiona a parte Supabase que antes existia somente no projeto remoto.

## Pré-requisitos de produção

1. Aplicar a migration em um branch/staging e executar os testes de autorização.
2. Configurar, no Supabase Auth, a proteção contra senhas vazadas e MFA para administradores.
3. Configurar, no Supabase Secrets, os secrets WEBHOOK_SECRET, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, RESEND_API_KEY, EMAIL_FROM, APP_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, MP_PLATAFORMA_ACCESS_TOKEN e MP_PLATAFORMA_WEBHOOK_SECRET.
   - Recebimento de aluguel na conta da própria imobiliária (Mercado Pago Connect), secrets adicionais:
     - `MP_CLIENT_ID` e `MP_CLIENT_SECRET` — credenciais da APLICAÇÃO Mercado Pago (marketplace/Connect).
     - `MP_OAUTH_REDIRECT_URI` — URL pública da função `mp-oauth-callback` (deve bater com a cadastrada na aplicação MP).
     - `MP_TOKEN_ENC_KEY` — chave AES-GCM (base64 de 32 bytes) para cifrar os tokens em repouso. Gerar: `openssl rand -base64 32`.
     - `MP_ALUGUEL_WEBHOOK_URL` — URL pública da função `mp-aluguel-webhook` (usada como notification_url das cobranças).
     - `MP_ALUGUEL_WEBHOOK_SECRET` — segredo do webhook (assinatura x-signature) configurado na aplicação MP.
     - `APP_URL_IMOB` (opcional) — URL do app da imobiliária para onde o callback retorna; se ausente, usa `APP_URL`.
     - `SUPABASE_ANON_KEY` — necessário para as funções autenticadas validarem o JWT do usuário (mp-oauth-start, cobrar-aluguel).
     - `MP_REFRESH_CRON_SECRET` — segredo que autentica o cron ao chamar `mp-oauth-refresh` (renovação dos tokens ~180 dias). Definir o MESMO valor no banco:
       `alter database postgres set app.settings.mp_refresh_key = '<MP_REFRESH_CRON_SECRET>';`
       O cron `mp-oauth-refresh` (03:20 UTC diário) já está agendado e faz no-op enquanto essa config não existir.
4. Usar APP_URL com HTTPS e domínio oficial do produto.
5. Publicar as Edge Functions com verify_jwt=false somente para os webhooks/Database Webhooks listados; as demais devem permanecer com JWT obrigatório.
   - `--no-verify-jwt` (públicas): `mp-webhook`, `mp-mensalidade-webhook`, `mp-aluguel-webhook`, `mp-oauth-callback`, `mp-oauth-refresh`.
   - JWT obrigatório (padrão): `mp-oauth-start`, `cobrar-aluguel`.
   - Comandos:
     - `supabase functions deploy mp-oauth-callback --no-verify-jwt --project-ref bklvbhsaxcmrnjxjbzjh`
     - `supabase functions deploy mp-aluguel-webhook --no-verify-jwt --project-ref bklvbhsaxcmrnjxjbzjh`
     - `supabase functions deploy mp-oauth-refresh --no-verify-jwt --project-ref bklvbhsaxcmrnjxjbzjh`
     - `supabase functions deploy mp-oauth-start --project-ref bklvbhsaxcmrnjxjbzjh`
     - `supabase functions deploy cobrar-aluguel --project-ref bklvbhsaxcmrnjxjbzjh`
6. Executar os Supabase Advisors depois da migration e não aceitar regressões de RLS, grants ou funções privilegiadas.

## Regras de revisão

- Toda função SECURITY DEFINER deve validar o usuário e o tenant internamente.
- Nenhuma policy deve usar user_metadata para autorização.
- Toda alteração de status de pagamento deve ser idempotente.
- Os dados de integration_webhook_events são internos e não têm acesso para anon ou authenticated.
- Não publicar a service_role no navegador, CI público ou logs.

## Publicação

A publicação deve ser feita pelo pipeline/CLI autenticado do projeto, após revisão da migration em staging. A conta atual atingiu o limite de execução remota durante esta implementação; por isso estes arquivos estão prontos e não foram publicados automaticamente.
