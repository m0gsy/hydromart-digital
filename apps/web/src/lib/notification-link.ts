import { resolveDeepLink, webTwin } from './deep-link';
import { notificationHome } from './roles';
import { canOpenRoute } from './route-access';

/**
 * Where a row in a notification feed should take the person who taps it, or null when it
 * should stay plain text.
 *
 * `destination` is a server-written string and an href is not a tap, so two guards:
 *  - an absolute URL is refused outright. `resolveDeepLink` strips the origin and hands back
 *    the path, which is right for a tap on a push and wrong for a link in a list.
 *  - `/` is refused unless the row actually asked for `/`. That is what the resolver answers
 *    for a route this binary does not carry, and a row about an order must not quietly become
 *    a link to the home screen.
 *
 * Anything left is a route this app serves. Anything else stays plain text, because an
 * affordance that leads nowhere is worse than none.
 */
export function notificationHref(
  destination: string | null | undefined,
  /**
   * Flow 6a: the reader. A depot feed carries every alert of the depot, and a row linking to a
   * screen this role is refused is an affordance that lies: it stays plain text instead.
   */
  role?: string | null,
  /** The desktop console's feed: a phone-console destination opens on its desktop twin. */
  desk = false,
): string | null {
  const internal =
    destination && destination.startsWith('/') && !destination.startsWith('//') ? destination : null;
  const resolved = internal ? resolveDeepLink(desk ? webTwin(internal) : internal) : null;
  if (resolved === '/' && internal !== '/') return null;
  return resolved && role && !canOpenRoute(resolved, role) ? null : resolved;
}

/**
 * Flow 6a: where a tapped push lands for this reader, the tray and the in-app toast alike. A
 * push names the screen its event is about, and a depot alert reaches every account at the
 * depot, not only the roles that may open that screen: those land on their own feed, where
 * the alert is, instead of a page that refuses them.
 */
export function pushTarget(path: string, role: string | null | undefined): string {
  return role && !canOpenRoute(path, role) ? notificationHome(role) : path;
}
