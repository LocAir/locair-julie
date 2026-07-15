// Service worker minimal : recevoir les notifications push même quand
// l'onglet/l'app est fermé, et refléter un badge sur l'icône de l'app tant
// que la notification n'a pas été vue (voir clearAppBadge() dans index.html,
// appelé à l'ouverture/premier plan de l'app).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || "Loc'Air";
  const options = {
    body: data.body || '',
    tag:  data.tag || 'locair',
    data: { url: data.url || '/transporteur/', tag: data.tag || 'locair' },
    requireInteraction: true,
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    (self.navigator && self.navigator.setAppBadge) ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/transporteur/';
  const tag = (event.notification.data && event.notification.data.tag) || '';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('/transporteur') && 'focus' in c) {
          // L'onglet est déjà ouvert : le focus seul ne suffit pas pour lui
          // dire pourquoi on clique (ex. deep-link vers une mission précise)
          // — on lui passe l'info via postMessage plutôt qu'une navigation
          // complète, qui perdrait l'état en mémoire de l'app.
          c.postMessage({ type: 'notification-click', url, tag });
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
