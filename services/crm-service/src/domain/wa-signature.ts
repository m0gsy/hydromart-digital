import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta signs the RAW request body: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(body, app secret)>`. The
 * comparison is constant time after a length check, over the bytes as received (a re-serialised body with
 * another key order is a different body and must fail). An empty secret refuses everything.
 */
export function verifyMetaSignature(secret: string, rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!secret || !rawBody || !header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
