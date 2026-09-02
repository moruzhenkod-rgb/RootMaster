const CACHE_NAME = 'routemaster-v151';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './vendor/cropper.min.css',
  './vendor/cropper.min.js',
  './js/utils.js',
  './js/api.js',
  './js/storage.js',
  './js/geocode.js',
  './js/client-match.js',
  './js/testdata.js',
  './js/place-picker.js',
  './js/radar/ui-radar-v2.js',
  './js/radar/radar-engine.js',
  './js/radar/traffic.js',
  './js/radar/db.js',
  './js/cam-scanner.js',
  './js/audio-manager.js',
  './js/radar-module.js',
  './js/ui-radar.js',
  './js/ui-home.js',
  './js/ui-auth.js',
  './js/ui-clients.js',
  './js/ui-manual.js',
  './js/ui-settings.js',
  './js/ui-paste.js',
  './js/ui-scan.js',
  './js/ui-validate.js',
  './js/ui-build.js',
  './js/ui-active.js',
  './js/ui-active-users.js',
  './js/router.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './audio/radar/system_start.mp3',
  './audio/radar/system_stop.mp3',
  './audio/radar/system_gps_lost.mp3',
  './audio/radar/system_gps_found.mp3',
  './audio/radar/system_updated.mp3',
  './audio/radar/cam_1000m.mp3',
  './audio/radar/cam_500m.mp3',
  './audio/radar/cam_500m_red.mp3',
  './audio/radar/cam_500m_mobile.mp3',
  './audio/radar/cam_200m.mp3',
  './audio/radar/limit_30.mp3',
  './audio/radar/limit_50.mp3',
  './audio/radar/limit_60.mp3',
  './audio/radar/limit_70.mp3',
  './audio/radar/limit_80.mp3',
  './audio/radar/limit_100.mp3',
  './audio/radar/hazard_work_500m.mp3',
  './audio/radar/hazard_accident_500m.mp3',
];

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  // precache пофайлово: один недоступный файл не рушит всё обновление
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
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

  // Same-origin — CACHE-FIRST из версионного кеша: все файлы ОДНОЙ версии (никакой мешанины
  // свежее/старое на мобильной сети). Новая версия приходит целиком при обновлении SW.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => new Response('', { status: 504, statusText: 'offline' }));
    })
  );
});
