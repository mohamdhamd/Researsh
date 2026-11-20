const CACHE_NAME = 'farm-reports-hub-v4';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/style.css',
  './js/app.js',
  './js/scene3d.js',
  './js/lib/three.min.js',
  './data/reports-index.js',
  './data/reports/sharqia-calves.js',
  './data/reports/sharqia-baladi-bulls.js',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

async function cacheUrlsSafely(cache, urls) {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const req = new Request(url, { cache: 'reload' });
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        await cache.put(url, res.clone());
      }
    })
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cacheUrlsSafely(cache, CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// استقبال أمر "حفظ للأوفلاين" أو تفعيل التحديث من الزرار جوه الموقع
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type !== 'CACHE_ALL_OFFLINE') return;
  const extraUrls = Array.isArray(event.data.urls) ? event.data.urls : [];
  const allUrls = Array.from(new Set([...CORE_ASSETS, ...extraUrls]));

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const saved = await cacheUrlsSafely(cache, allUrls);
      const clients = await self.clients.matchAll();
      clients.forEach((client) =>
        client.postMessage({ type: 'OFFLINE_READY', saved, total: allUrls.length })
      );
    })
  );
});

// استراتيجية: الكاش أولًا للأوفلاين السريع + تحديث في الخلفية لو فيه إنترنت
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});