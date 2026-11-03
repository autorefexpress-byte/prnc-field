// Cache hors ligne de l'app : elle s'ouvre même avec un réseau faible ou coupé.
// - Page de l'app : réseau d'abord (toujours la dernière version), copie du téléphone
//   si le réseau ne répond pas à temps ou est coupé.
// - Librairie Excel (URL versionnée, ne change jamais) et qrcode.js : copie du téléphone d'abord.
// - API (/api/) et envois (POST, PATCH…) : jamais mis en cache, toujours le réseau.
const CACHE = 'prnc-v40';
const DELAI_RESEAU = 4000;   // au-delà, on ouvre la copie du téléphone (la mise à jour continue en fond)
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
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Réseau d'abord avec délai : la réponse du réseau met aussi la copie à jour, même si elle arrive après le délai
function pageReseauDabord(request) {
  const reseau = fetch(request).then(res => {
    if (res && res.ok) {
      const copie = res.clone();
      caches.open(CACHE).then(c => c.put(PAGE, copie));
    }
    return res;
  });
  return new Promise(resolve => {
    let fini = false;
    const servir = r => { if (!fini) { fini = true; resolve(r); } };
    // Réseau trop lent : la copie du téléphone si elle existe, sinon on continue d'attendre le réseau
    const timer = setTimeout(() => caches.match(PAGE).then(c => { if (c) servir(c); }), DELAI_RESEAU);
    reseau.then(
      res => { clearTimeout(timer); if (res.ok) servir(res); else caches.match(PAGE).then(c => servir(c || res)); },
      () => { clearTimeout(timer); caches.match(PAGE).then(c => servir(c || Response.error())); }
    );
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Données dynamiques et envois : toujours le réseau, jamais de copie (sinon données périmées)
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Ouverture de l'app (page HTML)
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(pageReseauDabord(req));
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
