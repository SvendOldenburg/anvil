// App-shell cache. Training data always comes live from PocketBase
// (cross-origin, never cached here). Bump CACHE on any frontend change.
const CACHE = 'anvil-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/config.js',
  './js/api.js',
  './js/exercises.js',
  './js/timer.js',
  './js/views/home.js',
  './js/views/workout.js',
  './js/views/rower.js',
  './js/views/kettlebell.js',
  './js/views/body.js',
  './js/views/barbell.js',
  './js/views/dumbbell.js',
  './js/views/history.js',
  './icons/favicon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // PocketBase API, Google Fonts, the Chart.js CDN -- always network.
  if (url.origin !== self.location.origin) return;

  // App shell: cache first, then network (caching what comes back), then
  // index.html. That last fallback is also what makes the app satisfy
  // Chrome's "responds when offline" install criterion -- the old handler
  // resolved to undefined on a cache miss.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(e.request).then(resp => {
        if (resp.ok && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
