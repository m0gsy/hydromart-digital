import { createHash, randomBytes } from 'node:crypto';

import { ApiKeyEnvironment } from './api-key-environment';

// API key generation (Design 13d). The full secret is returned ONCE to the caller;
// only the display-safe prefix and a sha256 hash are ever persisted.

export interface GeneratedApiKey {
  /** The full secret — shown once at creation/rotation, never stored. */
  token: string;
  /** Display-safe leading segment, e.g. "hm_live_a1b2c3d4". */
  keyPrefix: string;
  /** sha256(token), hex — stored for later verification. */
  keyHash: string;
}

/** sha256 of a full key token (hex). Exposed for a future verify/last-used lookup. */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint a fresh key for an environment: `hm_<live|test>_<32-char random>`. */
export function generateApiKey(environment: ApiKeyEnvironment): GeneratedApiKey {
  const segment = environment === ApiKeyEnvironment.STAGING ? 'test' : 'live';
  const secret = randomBytes(24).toString('base64url'); // 32 url-safe chars
  const token = `hm_${segment}_${secret}`;
  return { token, keyPrefix: token.slice(0, 16), keyHash: hashApiKey(token) };
}
