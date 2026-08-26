// CondoApp — Service Worker (PWA: instalável + shell offline básico).
const CACHE = "condoapp-v22";
const SHELL = ["/", "/index.html", "/condominio.html", "/login", "/imobiliaria.html", "/admin.html", "/pagamento.html",
  "/app.css", "/app.js", "/helpers.js", "/ui-a11y.js", "/theme.css", "/plans.js", "/qrcode.js", "/jsqr.js",
  "/manifest.webmanifest", "/manifest-imobiliaria.webmanifest", "/manifest-morador-imob.webmanifest", "/manifest-proprietario.webmanifest", "/admin.webmanifest",
  "/logo-dark.png", "/logo-white.png",
  "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"];
const SAFE_TABS = new Set([
  "inicio", "ocorrencias", "portaria", "encomendas", "servicos", "reservas",
  "financeiro", "assembleias", "enquetes", "manutencoes", "mural", "livro",
  "documentos", "gestao", "atendimento", "contas", "perfil", "cadastros",
  "vagas", "autorizacoes", "conversas", "pesquisas", "consumo", "painel", "sos"
]);
const PROTECTED_NAVIGATION = new Set(["/admin", "/admin.html", "/condominio", "/condominio.html", "/morador", "/sindico", "/portaria", "/imobiliaria", "/imobiliaria.html", "/morador-imob", "/proprietario", "/pagamento", "/pagamento.html"]);
const isProtectedNavigation = (pathname) => PROTECTED_NAVIGATION.has(pathname);
function safeNotificationLink(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const tab = raw.replace(/^#/, "");
  return SAFE_TABS.has(tab) ? "#" + tab : "#inicio";
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Supabase (API/Auth/Storage): sempre rede — nunca cachear dados/sessão.
  if (url.hostname.endsWith("supabase.co")) return;

  // Biblioteca do CDN (esm.sh): cache-first (acelera e permite abrir offline
  // depois do primeiro acesso; o primeiro acesso ainda precisa de rede).
  if (url.hostname === "esm.sh") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Leaflet usado pelos mapas: cacheia depois do primeiro acesso para que a
  // estrutura do app continue abrindo em conexões instáveis.
  if (url.hostname === "unpkg.com") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Navegação (HTML): network-first, cai para o cache quando offline.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        // O shell é estático e não contém dados de usuário, mas não persistimos
        // respostas de navegação com query string ou URL externa.
        if (url.origin === self.location.origin && !url.search && !isProtectedNavigation(url.pathname)) c.put(req, res.clone());
        return res;
      } catch {
        const cachedNavigation = await caches.match(req);
        if (cachedNavigation) return cachedNavigation;
        const pathname = url.pathname;
        const fallback = /imobiliaria|morador-imob|proprietario/.test(pathname)
          ? "/imobiliaria.html"
          : pathname.includes("admin") ? "/admin.html"
          : pathname.includes("pagamento") ? "/pagamento.html"
          : pathname === "/" ? "/index.html"
          : "/condominio.html";
        return (await caches.match(fallback)) || (await caches.match("/index.html"));
      }
    })());
    return;
  }

  // Demais estáticos do próprio domínio: stale-while-revalidate.
  // Serve do cache na hora (rápido/offline) e revalida em segundo plano — assim
  // uma nova versão de app.js/app.css chega sozinha no carregamento seguinte,
  // sem depender de bump manual da versão do cache.
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});

// ---- Web Push ----
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "CondoApp", body: e.data ? e.data.text() : "" }; }
  const title = String(d.title || "CondoApp").slice(0, 80);
  const options = {
    body: String(d.body || "").slice(0, 500),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { link: safeNotificationLink(d.link) },
    tag: typeof d.tag === "string" ? d.tag.slice(0, 80) : undefined,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = safeNotificationLink(e.notification.data?.link);
  const APPS = ["/condominio", "/morador", "/sindico", "/portaria", "/login"];
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // foca uma janela do app já aberta (qualquer papel) e navega pelo hash
    for (const c of all) {
      if (APPS.some((p) => c.url.includes(p))) { await c.focus(); c.postMessage({ type: "notif-open", link }); return; }
    }
    // nenhuma janela aberta: abre o login, que roteia para o app do papel
    await self.clients.openWindow("/condominio" + (link.startsWith("#") ? link : ""));
  })());
});
