const CACHE_NAME = 'routemaster-v44';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/utils.js',
  './js/api.js',
  './js/storage.js',
  './js/geocode.js',
  './js/testdata.js',
  './js/ui-home.js',
  './js/ui-auth.js',
  './js/ui-clients.js',
  './js/ui-paste.js',
  './js/ui-scan.js',
  './js/ui-validate.js',
  './js/ui-build.js',
  './js/ui-active.js',
  './js/router.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for cross-origin (OSM tiles, Nominatim, CDN libs) — always try fresh, fallback to cache
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || new Response('', { status: 504, statusText: 'offline' }))
        )
    );
    return;
  }

  // Same-origin app shell — stale-while-revalidate:
  // отдаём из кеша сразу (быстро + оффлайн), а в фоне тянем свежую версию и обновляем кеш
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
          return res;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'offline' }));
      return cached || network;
    })
  );
});
