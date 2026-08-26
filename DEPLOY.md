# Checklist de deploy — melhorias do frontend

> A pasta deploy/ é o pacote de entrega. O frontend é estático e as migrations
> e Edge Functions do Supabase estão versionadas em deploy/supabase/.
> A aplicação remota deve ser feita em staging e revisada antes de produção.

---

## ✅ 1. Frontend — só publicar os arquivos estáticos

- **Leaflet fixado** na versão `1.9.4` via CDN. O service worker mantém os
  arquivos em cache depois do primeiro acesso; o primeiro acesso ainda precisa
  de rede.
- **Zoom liberado** (acessibilidade): removido `maximum-scale=1, user-scalable=no`
  de `admin.html`, `condominio.html`, `imobiliaria.html`.
- **Service worker** `sw.js` → cache `condoapp-v21`; pré-cacheia o shell do app e
  aplica cache em runtime para os CDNs fixados.
- **`index.html`** é o arquivo canônico da landing page servido em `/`.
- **Tela de Anúncios da imobiliária** agora mostra a **URL pública do feed** pronta
  para colar no ZAP/OLX (botões abrir/copiar), em vez do aviso "falta ligar".
- **Deploy de backend protegido**: os scripts agora interrompem a execução quando
  o checkout está sem `supabase/migrations` ou `supabase/functions`.

**Publicar** = subir os estáticos (Vercel/Netlify). O SW novo (v21) troca o antigo
sozinho no próximo acesso.

---

## ⏳ 2. Backend — aplicar em staging

Antes de publicar mudanças de banco, revise supabase/migrations/ e
supabase/functions/, execute os testes de autorização e aplique em staging
com **Supabase Studio → SQL Editor** ou pela **CLI** (supabase db push).

### Checklist recomendado

- revisar índices de foreign keys e políticas RLS;
- garantir que RPCs autenticadas não sejam executáveis por `anon`;
- paginar consultas administrativas e limitar listas exibidas na interface;
- ativar “Leaked Password Protection” em Authentication → Policies (Password);
- validar webhooks e retornos do Mercado Pago no servidor, nunca apenas no cliente.

O checklist técnico completo está em [BACKEND-HARDENING.md](BACKEND-HARDENING.md).
