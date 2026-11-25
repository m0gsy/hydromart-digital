import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * H-30: what makes an outbound webhook trustworthy at the far end, and what keeps a dead
 * endpoint from being hammered. Pure functions — the service does the I/O.
 */

/**
 * HD-7: every event a service publishes, and so every event an endpoint can subscribe to.
 *
 * The registration form takes event names as free text. An endpoint subscribed to a name no
 * service publishes (a typo, or `order.created`, which never existed) was accepted and then
 * received nothing, forever, with nothing anywhere saying why. contracts/ai-v1/events.openapi.json
 * describes the bodies.
 */
export const WEBHOOK_EVENTS = [
  'delivery.delivered',
  'franchise.application_submitted',
  'order.created',
  'order.status_changed',
  'stock.low',
] as const;

/**
 * HD-7: a signing secret is required, and has to be long enough to be one: 32 to 200
 * printable ASCII characters, no spaces. A generated one is 64 hex characters.
 */
export const WEBHOOK_SECRET_PATTERN = /^[!-~]{32,200}$/;

/** Attempts before a delivery is abandoned as DEAD. */
export const MAX_ATTEMPTS = 6;

/** 1m, 5m, 25m, 2h5m, 10h25m — then DEAD. */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_FACTOR = 5;

export function nextAttemptDelayMs(attempts: number): number {
  return BACKOFF_BASE_MS * BACKOFF_FACTOR ** Math.max(0, attempts - 1);
}

/**
 * `sha256=<hmac>` over `<timestamp>.<body>`, the Stripe/GitHub convention.
 *
 * The timestamp is inside the signed string, not beside it: signing the body alone lets
 * anyone who captures one request replay it forever, and the receiver has no way to tell.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Constant-time compare, for a receiver implemented against this same helper. It checks the
 * signature only: a receiver also refuses a timestamp more than 300 s from its own clock
 * (contracts/ai-v1/events.openapi.json), or one captured request is good forever.
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Rolling success rate 0..100, rounded. Null when nothing has been attempted yet. */
export function successRatePct(delivered: number, attempted: number): number | null {
  if (attempted <= 0) return null;
  return Math.round((delivered / attempted) * 100);
}
