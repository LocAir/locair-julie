// Service worker minimal : uniquement pour recevoir les notifications push
// même quand l'onglet/l'app est fermé. Pas de cache/offline pour l'instant.
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
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/transporteur/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('/transporteur') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
