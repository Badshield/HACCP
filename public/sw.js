// Service worker minimal : permet l'installation en application (PWA) et
// garde l'interface disponible si le réseau est coupé. Les données (/api)
// ne sont jamais mises en cache.
const CACHE = 'haccp-v3';
const ASSETS = ['/app', '/app.js', '/core.js', '/photos.js', '/fun.js', '/home.js', '/styles.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('/app') : undefined)))
  );
});
