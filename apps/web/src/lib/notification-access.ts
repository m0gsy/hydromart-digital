import { notificationHref } from './notification-link';
import { notificationHome } from './roles';
import { canOpenRoute } from './route-access';

/*
 * Flow 6a: where a notification may take THIS reader. Its own module because `canOpenRoute`
 * carries the console nav tables: the staff feeds import it, and the shell components that
 * are on every page (native-bridge, push-foreground) load it only when a push is tapped, so
 * the customer's pages do not pay for it (the Lighthouse transfer ceiling caught that).
 */

/**
 * A feed row's link for this reader. A depot feed carries every alert of the depot, and a row
 * linking to a screen this role is refused is an affordance that lies: it stays plain text.
 */
export function feedHref(
  destination: string | null | undefined,
  role: string | null | undefined,
  desk = false,
): string | null {
  const href = notificationHref(destination, desk);
  return href && role && !canOpenRoute(href, role) ? null : href;
}

/**
 * Where a tapped push lands for this reader, the tray and the in-app toast alike. A depot
 * alert reaches every account at the depot, not only the roles that may open its screen:
 * those land on their own feed, where the alert is, instead of a page that refuses them.
 */
export function pushTarget(path: string, role: string | null | undefined): string {
  return role && !canOpenRoute(path, role) ? notificationHome(role) : path;
}
