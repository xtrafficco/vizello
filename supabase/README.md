# Backend de segurança do Vizello

Este diretório versiona a parte Supabase que antes existia somente no projeto remoto.

## Pré-requisitos de produção

1. Aplicar a migration em um branch/staging e executar os testes de autorização.
2. Configurar, no Supabase Auth, a proteção contra senhas vazadas e MFA para administradores.
3. Configurar, no Supabase Secrets, os secrets WEBHOOK_SECRET, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, RESEND_API_KEY, EMAIL_FROM, APP_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, MP_PLATAFORMA_ACCESS_TOKEN e MP_PLATAFORMA_WEBHOOK_SECRET.
4. Usar APP_URL com HTTPS e domínio oficial do produto.
5. Publicar as Edge Functions com verify_jwt=false somente para os webhooks/Database Webhooks listados; as demais devem permanecer com JWT obrigatório.
6. Executar os Supabase Advisors depois da migration e não aceitar regressões de RLS, grants ou funções privilegiadas.

## Regras de revisão

- Toda função SECURITY DEFINER deve validar o usuário e o tenant internamente.
- Nenhuma policy deve usar user_metadata para autorização.
- Toda alteração de status de pagamento deve ser idempotente.
- Os dados de integration_webhook_events são internos e não têm acesso para anon ou authenticated.
- Não publicar a service_role no navegador, CI público ou logs.

## Publicação

A publicação deve ser feita pelo pipeline/CLI autenticado do projeto, após revisão da migration em staging. A conta atual atingiu o limite de execução remota durante esta implementação; por isso estes arquivos estão prontos e não foram publicados automaticamente.
