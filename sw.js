const CACHE_NAME = 'farm-reports-hub-v7';

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
  './data/reports/menoufia-beef-dairy-2026.js'
];

const IMMUTABLE_PATHS = ['/js/lib/three.min.js', 'cdnjs.cloudflare.com'];

async function cacheUrlsSafely(cache, urls) {
  let saved = 0;
  let failed = 0;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (!res || (!res.ok && res.type !== 'opaque')) {
          throw new Error('Bad response');
        }
        await cache.put(url, res.clone());
        saved++;
      } catch (_) {
        failed++;
      }
    })
  );
  return { saved, failed, total: urls.length };
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
      const stats = await cacheUrlsSafely(cache, allUrls);
      const payload = { type: 'OFFLINE_READY', ...stats };
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage(payload);
      }
      const clients = await self.clients.matchAll();
      clients.forEach((client) => client.postMessage(payload));
    })
  );
});

function fetchWithTimeout(request, ms = 3500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// استراتيجية ذكية:
// - مكتبة Three.js الضخمة: كاش أولًا للسرعة
// - ملفات الموقع والتقارير: الشبكة أولًا (بحد أقصى 3.5 ثانية) لتنزيل التحديثات فورًا، مع الرجوع للكاش أوفلاين
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (!url.startsWith('http')) return;

  const isImmutable = IMMUTABLE_PATHS.some((p) => url.includes(p));
  if (isImmutable) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetchWithTimeout(event.request, 3500)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      })
  );
});
