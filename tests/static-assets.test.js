import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("rotas de deploy apontam para arquivos existentes", () => {
  const redirects = read("_redirects");
  const redirectTargets = redirects
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/)[1])
    .filter(target => target?.startsWith("/"));
  for (const target of redirectTargets) {
    assert.ok(fs.existsSync(path.join(root, target.slice(1))), `alvo ausente em _redirects: ${target}`);
  }

  const vercel = JSON.parse(read("vercel.json"));
  for (const rewrite of vercel.rewrites ?? []) {
    const target = rewrite.destination;
    if (target?.startsWith("/")) {
      assert.ok(fs.existsSync(path.join(root, target.slice(1))), `alvo ausente em vercel.json: ${target}`);
    }
  }
});

test("headers de segurança estão declarados nos provedores configurados", () => {
  const vercel = read("vercel.json");
  const headers = read("_headers");
  for (const name of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Cross-Origin-Opener-Policy"]) {
    assert.match(vercel, new RegExp(name), `header ausente no Vercel: ${name}`);
    assert.match(headers, new RegExp(name), `header ausente no Netlify: ${name}`);
  }
  assert.match(vercel, /script-src-attr 'none'/);
  assert.match(headers, /script-src-attr 'none'/);
  assert.match(vercel, /Cache-Control.*no-store/);
  assert.match(headers, /Cache-Control: no-store/);
});

test("preços públicos usam a fonte compartilhada de planos", () => {
  const plans = read("plans.js");
  assert.match(plans, /essencial:\s*Object\.freeze/);
  assert.match(plans, /pro:\s*Object\.freeze/);
  assert.match(read("index-app.js"), /import \{ PLAN_PRICES, planBRL \} from "\.\/plans\.js"/);
  assert.match(read("cadastro-app.js"), /import \{ PLAN_PRICES, planBRL \} from "\.\/plans\.js"/);
  assert.match(read("sw.js"), /"\/plans\.js"/);
});

test("fluxos críticos falham fechados quando a assinatura não pode ser validada", () => {
  const app = read("app.js");
  const imob = read("imobiliaria-app.js");
  assert.match(app, /minha_assinatura_vizello/);
  assert.match(app, /Não foi possível validar a assinatura/);
  assert.match(imob, /minha_assinatura_imob/);
  assert.match(imob, /Não foi possível validar a assinatura/);
  assert.doesNotMatch(imob, /minha_assinatura_imob[\s\S]{0,240}\.catch\(\(\)=>null\)/);
});

test("deploy não promete backend ausente", () => {
  assert.match(read("deploy-supabase.ps1"), /supabase[\\/]migrations/);
  assert.match(read("deploy-supabase.sh"), /supabase[\\/]migrations/);
  assert.match(read("BACKEND-HARDENING.md"), /RLS/);
});

test("baseline Supabase e Edge Functions versionados exigem defesa em profundidade", () => {
  const migration = read("supabase/migrations/20260826130000_security_hardening_baseline.sql");
  assert.match(migration, /revoke all on table[\s\S]*plataforma_checkout_pedidos/i);
  assert.match(migration, /integration_webhook_events/);
  assert.match(read("supabase/functions/_shared/security.ts"), /timestampFresh/);
  assert.match(read("supabase/functions/enviar-push/index.ts"), /!webhookSecret/);
  assert.match(read("supabase/functions/notificar-email/index.ts"), /internalAppLink/);
  assert.match(read("supabase/functions/mp-webhook/index.ts"), /integration_webhook_events/);
  assert.match(read("supabase/functions/mp-mensalidade-webhook/index.ts"), /timestampFresh/);
});
