// CondoApp — Service Worker (PWA: instalável + shell offline básico).
const CACHE = "condoapp-v17";
const SHELL = ["/condominio",
  "/app.css", "/app.js", "/helpers.js", "/theme.css", "/qrcode.js", "/jsqr.js",
  "/manifest.webmanifest",
  "/logo-dark.png", "/logo-white.png",
  "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"];

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

  // Biblioteca do CDN (esm.sh): cache-first (acelera e permite abrir offline).
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

  // Navegação (HTML): network-first, cai para o cache quando offline.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match("/condominio"));
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
  const title = d.title || "CondoApp";
  const options = {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { link: d.link || "#inicio" },
    tag: d.tag,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.notification.data?.link || "#inicio";
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
