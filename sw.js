// FinApp service worker.
//
// Purpose:
//   1. Make the app installable (Chrome surfaces "Install app" only when a SW
//      is registered).
//   2. Cache the app shell so launches from the home screen work without
//      network and feel instant.
//
// Strategy:
//   - HTML navigations  → network-first, fall back to cache.  Keeps deploys
//                         picked up immediately when online; works offline.
//   - Same-origin assets → cache-first.  These are small static files.
//   - Cross-origin requests (sql.js / Tailwind / Google Drive / Firebase /
//     Anthropic / GitHub) → pass through, never cached by us.
//
// To force a refresh, bump the CACHE name.

const CACHE = 'finapp-shell-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;  // skip cross-origin

  // Network-first for navigations / HTML
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() =>
          caches.match(e.request).then(r => r || caches.match('./'))
        )
    );
    return;
  }

  // Cache-first for other same-origin assets
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      })
    )
  );
});
