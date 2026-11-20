import { resolveDeepLink, webTwin } from './deep-link';

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
  /** The desktop console's feed: a phone-console destination opens on its desktop twin. */
  desk = false,
): string | null {
  const internal =
    destination && destination.startsWith('/') && !destination.startsWith('//') ? destination : null;
  const resolved = internal ? resolveDeepLink(desk ? webTwin(internal) : internal) : null;
  return resolved === '/' && internal !== '/' ? null : resolved;
}
