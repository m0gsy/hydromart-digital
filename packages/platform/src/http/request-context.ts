import { Request } from 'express';

import { RequestContext } from './authenticated-user';

const PRIVATE_V4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * Whether the machine that actually opened this socket is one of ours.
 *
 * The SOCKET peer, never `request.ip`: `trust proxy` makes `request.ip` read the very header
 * this function exists to decide about, so using it would ask the caller to vouch for
 * themselves. Same ranges the gateway uses to fence `/metrics`.
 */
export function isTrustedProxyPeer(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (PRIVATE_V4.some((range) => range.test(v4))) return true;
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd');
}

/**
 * Extract caller IP and user-agent for audit logging and records.
 *
 * CORE-3 / AUTH-4 — `x-forwarded-for` is a header, and a header is whatever the sender
 * typed. This read used to take its first hop unconditionally, so every audit row, every
 * session record and every rate-limit decision keyed on an address the caller chose:
 * `curl -H 'X-Forwarded-For: 8.8.8.8'` writes 8.8.8.8 into the security trail, and a brute
 * force rotating the header looks like a different person on each attempt.
 *
 * The header is only meaningful when something we run put it there. Behind the compose
 * reverse proxy (and behind Caddy in production) the socket peer IS that proxy — a private
 * address — and the header is the real client. A request that reaches a service directly
 * from the internet has a public peer, and then the socket address is the only thing that
 * cannot be forged: the header is ignored, not preferred.
 */
export function getRequestContext(request: Request): RequestContext {
  const peer = request.socket?.remoteAddress;
  const forwarded = request.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  const claimed = isTrustedProxyPeer(peer) ? forwardedIp : undefined;
  return {
    ipAddress: claimed || peer || request.ip || null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
