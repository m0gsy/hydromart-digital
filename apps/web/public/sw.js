/* Hydromart Web Push service worker (design 7b transport).
   Renders push payloads sent by crm-service and focuses/opens the app on click. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Hydromart';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

/*
 * F9. This matched an open window with `client.url.includes(url)` and focused whatever it
 * found. `includes` is a substring test over the WHOLE url, so:
 *
 *   - '/orders' matched https://app/orders/detail?id=someone-elses — the tap focused a tab
 *     showing a different order and then threw the destination away, because `focus()` does
 *     not navigate;
 *   - '/' — the fallback destination — matched literally every open tab.
 *
 * So "pesananmu sudah sampai" could land the customer on whatever they happened to have
 * open. Three rules now, in order:
 *
 *   1. a tab already ON the destination is reused (focus, nothing else to do);
 *   2. otherwise any open tab is reused and NAVIGATED to the destination — the tap must end
 *      where the notification pointed, and reusing a tab is still better than a new one;
 *   3. otherwise a window is opened.
 *
 * Compared on pathname + search, not on the raw string: the destinations crm builds are
 * relative ('/orders/detail?id=…') and a client url is absolute, so a substring test was
 * never comparing like with like in the first place.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const target = new URL(url, self.location.origin);
      const same = (raw) => {
        try {
          const u = new URL(raw, self.location.origin);
          return u.pathname === target.pathname && u.search === target.search;
        } catch {
          return false;
        }
      };
      for (const client of clientList) {
        if (same(client.url) && 'focus' in client) return client.focus();
      }
      for (const client of clientList) {
        // `navigate` is not on every implementation; where it is missing, opening a window
        // is still better than focusing a tab showing something else entirely.
        if ('navigate' in client && 'focus' in client) {
          return Promise.resolve(client.navigate(url))
            .then((c) => (c && 'focus' in c ? c.focus() : client.focus()))
            .catch(() => (self.clients.openWindow ? self.clients.openWindow(url) : undefined));
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
