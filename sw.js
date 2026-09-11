const CACHE = 'prnc-v4';
const FILES = [
  './',
  './index.html',
  './qrcode.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Les appels à l'API (données dynamiques) ne doivent jamais être mis en cache :
  // sinon l'appareil resterait bloqué sur un ancien snapshot (ex: liste de non-conformités vide)
  // au lieu de recevoir les données à jour du serveur.
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200) return res;
        var clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => cached);
    })
  );
});
