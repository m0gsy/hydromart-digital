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
 * K5.5 — the rewrite the rest of the app has and this file did not.
 *
 * F1 replaced every dynamic segment with a query parameter so the app could be exported
 * as plain files: `/orders/[id]` became `/orders/detail?id=`. `lib/deep-link.ts` rewrites
 * the old shape for the two NATIVE tap handlers, and it exists precisely because links in
 * the old shape are still in the world — notifications already sitting on phones, WhatsApp
 * messages, bookmarks. This file, the tap handler for every browser and installed PWA, did
 * not rewrite anything. Same payload, two behaviours: the native tap landed on the order,
 * the browser tap landed on a route that no longer exists.
 *
 * A service worker cannot import a TypeScript module, so these two lists are a second
 * copy of `DYNAMIC_PARENTS` and `NOT_AN_ID`. `test/sw-deep-link-parity.test.ts` reads both
 * sides and fails if they disagree — by list AND by behaviour over a generated table — so
 * the copy cannot drift the way an unwatched copy would.
 *
 * No pruning here, and that is deliberate rather than an omission: pruning is what the
 * mobile binaries do to their own route table, and this file only ever runs in a browser
 * serving the whole site.
 */
const DYNAMIC_PARENTS = [
  '/dashboard/purchase-orders',
  '/dashboard/approvals',
  '/dashboard/customers',
  '/m/manager/approvals',
  '/driver/deliveries',
  '/hq/applications',
  '/hr/me/payroll',
  '/hr/employees',
  '/hr/payroll',
  '/hq/access',
  '/hq/depots',
  '/hq/orders',
  '/products',
  '/orders',
];
const NOT_AN_ID = ['detail', 'new', 'import', 'settings'];

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (e) {
    return segment;
  }
}

/**
 * Rewrite a stale path shape into the route this build actually serves. Anything that is
 * not one of those shapes comes back untouched, which is the answer for every destination
 * crm-service builds today.
 */
function rewriteLegacyPath(raw) {
  const q = raw.indexOf('?');
  const path = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? '' : raw.slice(q + 1);
  let parent = null;
  for (const p of DYNAMIC_PARENTS) {
    if (path.indexOf(p + '/') === 0) {
      parent = p;
      break;
    }
  }
  if (parent === null) return raw;

  const rest = path.slice(parent.length + 1).split('/');
  const id = rest[0];
  if (!id || NOT_AN_ID.indexOf(id) !== -1) return raw;

  const child = rest.slice(1).join('/');
  const suffix = child ? '/' + child : '';
  const extra = query ? '&' + query : '';
  return parent + '/detail' + suffix + '?id=' + encodeURIComponent(safeDecode(id)) + extra;
}

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
  // K5.5: rewritten at CLICK rather than at push, on purpose — the notifications that
  // carry a stale shape are the ones already delivered to somebody's phone, and those
  // never pass through the push handler again.
  const raw = (event.notification.data && event.notification.data.url) || '/';
  const url = rewriteLegacyPath(raw);
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
