/**
 * ADM-1 — where a webhook is allowed to be sent.
 *
 * A partner registers the URL, and this service POSTs to it from inside the docker network
 * with no address check at all and `fetch`'s default redirect-following. So an endpoint's
 * owner could point us at `http://order:3004/api/v1/...`, at `http://localhost:9090`, or at
 * the cloud metadata service on 169.254.169.254 — and read the answer back through the
 * delivery's own `responseStatus` and `lastError`. Registering a public URL that 302s to a
 * private one does the same thing while looking innocent in the console.
 *
 * Two checks, because either alone is bypassable: the hostname is resolved (a public name
 * can resolve to 10.x — the classic DNS rebind), and redirects are not followed at all, so
 * every hop has to pass on its own.
 */
import { lookup as dnsLookup } from 'node:dns/promises';

const BLOCKED_V4 = [
  /^0\./, // "this host"
  /^10\./, // RFC1918
  /^127\./, // loopback
  /^169\.254\./, // link-local — cloud metadata lives here
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
];

export class WebhookDestinationBlockedError extends Error {
  constructor(reason: string) {
    super(`Webhook destination refused: ${reason}`);
  }
}

/** True for an address a webhook must never reach. */
export function isBlockedAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (BLOCKED_V4.some((range) => range.test(v4))) return true;
  const lower = address.toLowerCase();
  // ::, ::1, unique-local (fc/fd) and link-local (fe80::) are the v6 equivalents.
  return (
    lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
}

export type AddressLookup = (hostname: string) => Promise<{ address: string }[]>;

/** The real resolver. Named (not an inline default) so both callers share one, testable. */
export const defaultAddressLookup: AddressLookup = (hostname) =>
  dnsLookup(hostname, { all: true });

/**
 * Throws unless `url` is an https/http URL whose hostname resolves ONLY to public
 * addresses. Called at registration (so a bad endpoint is refused while somebody is
 * watching) and again at send time (so a name that changes its mind later is refused too).
 */
export async function assertSendableWebhookUrl(url: string, lookup: AddressLookup): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookDestinationBlockedError('not a URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new WebhookDestinationBlockedError(`protocol ${parsed.protocol}`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  // A literal address needs no DNS, and `lookup` on some platforms happily resolves one.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    if (isBlockedAddress(hostname)) throw new WebhookDestinationBlockedError(hostname);
    return;
  }
  // A bare name (`order`, `localhost`) only resolves inside our own network.
  if (!hostname.includes('.')) throw new WebhookDestinationBlockedError(hostname);

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname);
  } catch {
    // Unresolvable is not sendable. Failing closed here costs a partner one retry; failing
    // open costs the private network.
    throw new WebhookDestinationBlockedError(`${hostname} does not resolve`);
  }
  if (addresses.length === 0) throw new WebhookDestinationBlockedError(`${hostname} has no address`);
  const blocked = addresses.find((a) => isBlockedAddress(a.address));
  if (blocked) throw new WebhookDestinationBlockedError(`${hostname} resolves to ${blocked.address}`);
}
