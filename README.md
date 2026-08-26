# Pacote de publicação Vizello

Esta pasta é uma cópia congelada dos arquivos necessários para publicação.

## Frontend

Publique o conteúdo desta pasta em Vercel ou Netlify. Os arquivos de rota,
headers, manifests, service worker, imagens e scripts estão incluídos.

## Supabase

A subpasta supabase/ contém migrations e Edge Functions versionadas. A migration
de segurança deve ser aplicada primeiro em staging, seguida da publicação das
funções e da execução dos Advisors.

Não copie node_modules, chaves privadas ou arquivos de ambiente para este pacote.
Os secrets das Edge Functions devem permanecer configurados no Supabase Secrets.

Consulte DEPLOY.md e supabase/README.md antes da publicação.
