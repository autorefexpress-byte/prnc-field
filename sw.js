// Cache hors ligne de l'app : elle s'ouvre même avec un réseau faible ou coupé.
// - Page de l'app : copie du téléphone d'abord (ouverture instantanée), mise à jour en arrière-plan
//   et bandeau « Nouvelle version disponible » quand elle a changé.
// - Librairie Excel (URL versionnée, ne change jamais) et qrcode.js : copie du téléphone d'abord.
// - API (/api/) et envois (POST, PATCH…) : jamais mis en cache, toujours le réseau.
const CACHE = 'prnc-v43';
const PAGE = './index.html';
const FILES = [PAGE, './qrcode.js'];
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      c.addAll(FILES).then(() =>
        // La librairie Excel est un plus : si le CDN ne répond pas, l'installation réussit quand même
        c.add(XLSX_URL).catch(() => {})
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // prnc-donnees : copie des données de l'app (gérée par la page), à ne pas effacer
      Promise.all(keys.filter(k => k !== CACHE && k !== 'prnc-donnees').map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Page de l'app : la copie du téléphone s'ouvre tout de suite (instantané même en 4G faible),
// la version en ligne est téléchargée en arrière-plan. Si elle a changé, la copie est remplacée
// et la page affiche « Nouvelle version disponible » : un appui recharge.
// Sans copie (toute première ouverture) : le réseau.
function pageCopieDabord(e) {
  const majEnFond = fetch(e.request, { cache: 'no-cache' }).then(async res => {
    if (!res || !res.ok) return;
    const cache = await caches.open(CACHE);
    const ancienne = await cache.match(PAGE);
    const nouveau = await res.clone().text();
    await cache.put(PAGE, res);
    if (ancienne && (await ancienne.text()) !== nouveau) {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage('prnc-maj-dispo'));
    }
  }).catch(() => {});
  e.waitUntil(majEnFond);
  return caches.match(PAGE).then(copie => copie || fetch(e.request));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Données dynamiques et envois : toujours le réseau, jamais de copie (sinon données périmées)
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Ouverture de l'app (page HTML)
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(pageCopieDabord(e));
    return;
  }

  // Fichiers qui ne changent pas : copie du téléphone d'abord, sinon réseau (et mise en copie)
  if (req.url === XLSX_URL || (url.origin === self.location.origin && url.pathname.endsWith('/qrcode.js'))) {
    e.respondWith(
      caches.match(req.url).then(cached => cached || fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copie = res.clone();
          caches.open(CACHE).then(c => c.put(req.url, copie));
        }
        return res;
      }))
    );
  }
  // Tout le reste (photos Cloudinary, polices…) : comportement normal du navigateur
});
