// AdStay — service worker de l'application tablette (/adstay).
// Placé à la racine pour pouvoir couvrir « /adstay » (sans barre finale) ; il ne touche à rien d'autre.
// Pages : réseau d'abord (toujours la dernière version), copie de secours si Internet coupe.
// Scripts, logos, icônes : copie locale immédiate, mise à jour en arrière-plan.
// Rien d'extérieur (photos, polices, base AdStay, météo) : ces requêtes passent sans intervention.
const VERSION = 'adstay-v1';
const SHELL = ['/adstay', '/adstay/donnees.js', '/adstay/config.js', '/adstay/charger.js',
  '/adstay/vendor/qrcode-generator-1.4.4.js', '/adstay/logo-marque.webp', '/adstay/logo-marque-nuit.webp',
  '/adstay/manifest.webmanifest', '/adstay/app/icone-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('adstay-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith('/adstay')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(rep => {
      if (rep.ok && u.pathname === '/adstay') caches.open(VERSION).then(c => c.put('/adstay', rep.clone()));
      return rep;
    }).catch(() => caches.match(r).then(x => x || caches.match('/adstay'))));
    return;
  }
  e.respondWith(caches.match(r).then(copie => {
    const frais = fetch(r).then(rep => { if (rep.ok) caches.open(VERSION).then(c => c.put(r, rep.clone())); return rep; }).catch(() => copie);
    return copie || frais;
  }));
});
