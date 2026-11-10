import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';

/** The address a delivery is pinned to: the one the destination check validated, not a fresh lookup. */
export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedRequest {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type WebhookSender = (
  url: string,
  init: PinnedRequest,
  pin: PinnedAddress | null,
) => Promise<{ ok: boolean; status: number }>;

/** A `lookup` that answers only the pinned address, in whichever shape (all or one) the caller asks for. */
export function pinnedLookup(pin: PinnedAddress) {
  return (
    _host: string,
    options: { all?: boolean },
    cb: (err: Error | null, address: unknown, family?: number) => void,
  ): void => {
    if (options?.all) cb(null, [{ address: pin.address, family: pin.family }]);
    else cb(null, pin.address, pin.family);
  };
}

/**
 * AAS-15: send a webhook to the address that was VALIDATED, not to whatever the name resolves to a
 * moment later.
 *
 * The destination check resolves the hostname, refuses private addresses, and then `fetch` used to
 * resolve it AGAIN to connect: a record that answers a public address the first time and 10.x the
 * second (DNS rebinding) slipped through the gap. Here the connection's `lookup` is replaced by one
 * that returns the validated address, while the URL (so the Host header and the TLS name) stays the
 * partner's hostname. Redirects are never followed (a 3xx is just a status), the response body is
 * discarded, and the abort signal bounds the whole exchange.
 */
export const pinnedFetch: WebhookSender = (url, init, pin) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    const literal = isIP(target.hostname.replace(/^\[|\]$/g, '')) !== 0;
    const req = lib.request(
      target,
      {
        method: init.method,
        headers: { ...init.headers, 'Content-Length': String(Buffer.byteLength(init.body)) },
        signal: init.signal,
        // A literal address needs no lookup; a name connects ONLY to the pinned one.
        ...(pin && !literal
          ? {
              lookup: pinnedLookup(pin) as never,
            }
          : {}),
      },
      (res) => {
        const status = res.statusCode as number; // always set on a client response
        res.resume(); // the partner's body is not ours to read
        res.on('end', () => resolve({ ok: status >= 200 && status < 300, status }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(init.body);
  });
