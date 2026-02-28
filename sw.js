const CACHE_NAME = 'jabit-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/store.js',
  './js/app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js',
];

const APP_SHELL_PATHS = new Set(ASSETS.filter((asset) => !asset.startsWith('http')));
const ALLOWED_CDN_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
]);

function isCacheableRequest(requestUrl) {
  return requestUrl.origin === self.location.origin || ALLOWED_CDN_HOSTS.has(requestUrl.hostname);
}

function isCacheableResponse(response) {
  return Boolean(response && response.ok && response.type !== 'opaque');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {
        // If CDN assets fail, cache local assets only
        return cache.addAll(ASSETS.filter(a => !a.startsWith('http')));
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (!isCacheableRequest(requestUrl)) {
    return;
  }

  const isAppShellRequest =
    requestUrl.origin === self.location.origin
    && APP_SHELL_PATHS.has(requestUrl.pathname === '/' ? './' : `.${requestUrl.pathname}`);

  if (isAppShellRequest) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(event.request).then((response) => {
          if (isCacheableResponse(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for other safe assets.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (isCacheableResponse(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
