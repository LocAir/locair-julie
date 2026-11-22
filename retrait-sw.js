// Page du comptoir (/retrait) disponible même sans réseau (boutique en
// sous-sol, 4G faible). Réseau d'abord ; s'il manque, la dernière version
// gardée. Ne touche que /retrait : enregistré avec le scope « /retrait ».
// La validation d'un retrait ou d'un retour passe toujours par le serveur.
const CACHE = 'locair-retrait-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/retrait')).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('locair-retrait-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !/^\/retrait(\.html)?$/.test(url.pathname)) return;
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put('/retrait', copie)).catch(() => {}); }
      return r;
    }).catch(() => caches.match('/retrait').then((r) => r || Response.error()))
  );
});
