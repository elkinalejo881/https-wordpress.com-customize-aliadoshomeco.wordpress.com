// Service worker: guarda solo la "cáscara" de la app (HTML, estilos, fuentes, íconos). NUNCA guarda /api ni /_blob (datos clínicos).
const V = 'asisvet-portal-1';
const CORE = ['/', '/assets/app.css', '/assets/app.js', '/assets/fonts.css', '/assets/themes.css', '/assets/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/_blob/')) return;
  e.respondWith(fetch(r).then(res => { if (res.ok && (u.pathname === '/' || u.pathname.startsWith('/assets/'))) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
