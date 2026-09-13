// Service worker : (1) notifications push même app fermée [inchangé depuis
// l'origine] ; (2) mise en cache de l'app pour qu'elle s'ouvre et reste
// navigable sans réseau (Aly, 2026-09-14 — "je veux pouvoir naviguer même
// sans réseau, c'est important", le terrain a souvent une 4G capricieuse ou
// nulle en sous-sol/parking/ascenseur).
//
// Règle simple, volontairement stricte : ce service worker ne touche JAMAIS
// aux requêtes POST ni à /api/* — tous les appels réseau applicatifs (missions,
// actions, upload photo…) passent toujours en direct, jamais via le cache.
// Seuls les fichiers STATIQUES (page, police, carte Leaflet, icônes) sont mis
// en cache, pour que l'app elle-même (coquille + dernières données déjà vues)
// s'ouvre sans réseau — les DONNÉES fraîches (missions, statuts…) restent la
// responsabilité de index.html, qui garde sa propre copie dans localStorage
// (voir STATE, fetchMissions()) pour un affichage hors-ligne cohérent.
const CACHE_NAME = 'locair-transporteur-v1';
const APP_SHELL = [
  '/transporteur/',
  '/transporteur/index.html',
  '/transporteur/manifest.json',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Jamais de cache pour autre chose qu'un GET (POST /api/transporteur-*
  // notamment) — une action métier doit toujours atteindre le vrai serveur
  // ou échouer franchement, jamais recevoir une réponse mise en cache.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // /api/* exclu explicitement même si un jour un GET y apparaissait — les
  // données applicatives ne doivent jamais être servies depuis ce cache.
  if (url.pathname.startsWith('/api/')) return;

  // Navigation (ouverture/rechargement de l'app) : réseau d'abord (toujours
  // la version la plus fraîche quand elle est disponible), repli sur la
  // coquille en cache sinon — c'est ce qui permet à l'app de s'OUVRIR sans
  // réseau au lieu de l'erreur "Pas de connexion" du navigateur.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/transporteur/index.html', copy));
        return res;
      }).catch(() => caches.match('/transporteur/index.html'))
    );
    return;
  }

  // Reste (police, CSS/JS Leaflet, manifest, icône) : cache d'abord — ces
  // fichiers changent rarement, inutile de refaire la requête réseau à
  // chaque fois — puis va chercher et met en cache au passage si absent.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // Ne met en cache que les réponses correctes et de même origine ou
      // 'opaque' (cross-origin sans CORS, ex. certaines polices) — jamais une
      // erreur, sans quoi une 404/500 passagère resterait servie pour toujours.
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || "Loc'Air";
  const options = {
    body: data.body || '',
    tag:  data.tag || 'locair',
    data: { url: data.url || '/transporteur/' },
    requireInteraction: true,
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    (self.navigator && self.navigator.setAppBadge) ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
    // Prévient tout onglet déjà ouvert (app au premier plan ou juste en
    // arrière-plan) qu'un push vient d'arriver, pour qu'il se resynchronise
    // tout seul (voir le listener 'message' dans transporteur/index.html) —
    // sans ça, un changement fait côté admin (ex. créneau de récupération)
    // ne remontait à l'écran que si le livreur tapait la notification lui-même,
    // ou au prochain rafraîchissement automatique (toutes les 2h).
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      list.forEach((c) => c.postMessage({ type: 'locair-push' }));
    }),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/transporteur/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('/transporteur') && 'focus' in c) {
          // navigate() recharge l'onglet déjà ouvert sur l'URL exacte de la
          // notification (ex. la mission concernée) — avant, un onglet déjà
          // ouvert (cas courant en journée) se contentait de repasser au
          // premier plan sans y naviguer, laissant le livreur chercher
          // lui-même la mission dans la liste.
          if ('navigate' in c) return c.navigate(url).then((nc) => nc ? nc.focus() : clients.openWindow(url)).catch(() => {});
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
