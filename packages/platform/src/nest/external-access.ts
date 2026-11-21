import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

import { SetMetadata } from '@nestjs/common';

import {
  AI_TOKEN_AUDIENCE,
  EXTERNAL_JWKS_PATH,
  EXTERNAL_TOKEN_ALGORITHM,
  MACHINE_TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from './token-claims';

/**
 * HD-2 — who an ES256 token speaks for: `ai` is a person acting through the AI web, `machine`
 * is a machine account (n8n). Both are signed by auth-service; see token-claims.ts.
 */
export type ExternalCaller = 'ai' | 'machine';

export const EXTERNAL_ACCESS_KEY = 'externalAccess';

/**
 * The role a machine principal carries. It is no role at all on purpose: `can()` grants it
 * nothing, and DepotScopeGuard treats an unknown role as LOCKED to no depot. What a machine
 * may do is exactly its token's `scopes`, checked by RolesGuard.
 */
export const MACHINE_ROLE = 'MACHINE';

/**
 * Marks a route an ES256 token may reach, and for which callers. Every other route answers
 * 403 to such a token however valid it is: the AI web and the machine accounts get the read
 * API and the closed write list (Plan Eksekusi section 4), never the platform at large.
 *
 * `check-route-authz` requires `@Can(...)` beside it (the only rule a machine account can
 * satisfy), and the audit interceptor on a route that writes.
 */
export const ExternalAccess = (...callers: ExternalCaller[]): MethodDecorator & ClassDecorator =>
  SetMetadata(EXTERNAL_ACCESS_KEY, callers);

/** What a verified ES256 token says. */
export interface ExternalClaims {
  sub: string;
  via: ExternalCaller;
  /** The person's own role for `ai`; null for a machine account. */
  role: string | null;
  depotId: string | null;
  /** A machine account's closed capability list; empty for `ai`. */
  scopes: readonly string[];
}

const AUDIENCES = new Map<string, ExternalCaller>([
  [AI_TOKEN_AUDIENCE, 'ai'],
  [MACHINE_TOKEN_AUDIENCE, 'machine'],
]);

type Json = Record<string, unknown>;

function decodePart(part: string): Json | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

/** The `alg` a token CLAIMS. Never trusted for verification; it only picks the verifier. */
export function tokenAlgorithm(token: string): string | null {
  const alg = decodePart(token.split('.')[0] ?? '')?.alg;
  return typeof alg === 'string' ? alg : null;
}

/**
 * Verifies an ES256 token against the published keys: the signature under the key its `kid`
 * names, then issuer, exactly one external audience, expiry and not-before. Synchronous, so a
 * rate limiter can ask it too. Null for anything this deployment cannot prove it issued.
 */
export function verifyExternalToken(
  token: string,
  keys: ReadonlyMap<string, KeyObject>,
  nowMs: number = Date.now(),
): ExternalClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const header = decodePart(head);
  const payload = decodePart(body);
  if (!header || !payload) return null;
  if (header.alg !== EXTERNAL_TOKEN_ALGORITHM || typeof header.kid !== 'string') return null;
  const key = keys.get(header.kid);
  if (!key) return null;

  // A JWS ES256 signature is r||s, 64 bytes, not DER; `ieee-p1363` is that layout.
  const signature = Buffer.from(sig, 'base64url');
  if (signature.length !== 64) return null;
  const signed = Buffer.from(`${head}.${body}`);
  if (!verifySignature('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, signature)) {
    return null;
  }

  const now = nowMs / 1000;
  // One audience, as a string: a token for two audiences is a token for neither.
  const via = typeof payload.aud === 'string' ? AUDIENCES.get(payload.aud) : undefined;
  if (payload.iss !== TOKEN_ISSUER || !via) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > now)) {
    return null;
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (via === 'ai' && typeof payload.role !== 'string') return null;

  return {
    sub: payload.sub,
    via,
    role: via === 'ai' ? (payload.role as string) : null,
    depotId: typeof payload.depotId === 'string' ? payload.depotId : null,
    scopes:
      via === 'machine' && Array.isArray(payload.scopes)
        ? payload.scopes.filter((s): s is string => typeof s === 'string')
        : [],
  };
}

const TTL_MS = 30_000;
const MAX_STALE_MS = 60_000;
const RETRY_MS = 5_000;
const TIMEOUT_MS = 5_000;
const NO_KEYS: ReadonlyMap<string, KeyObject> = new Map();

export interface ExternalKeyStoreOptions {
  ttlMs?: number;
  maxStaleMs?: number;
  retryMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * The public keys auth-service publishes, re-read every 30 seconds.
 *
 * This is the kill switch: auth-service turns every AI and machine token off by publishing an
 * empty set, and each service has dropped the keys within one refresh. A set that cannot be
 * re-read is trusted for 60 seconds and then not at all, so the switch also holds when
 * auth-service goes down right after it is thrown. Failing closed costs the AI web its access
 * for that minute; failing open would make the switch a suggestion.
 */
export class ExternalKeyStore {
  private keys: ReadonlyMap<string, KeyObject> = NO_KEYS;
  private loadedAt = Number.NEGATIVE_INFINITY;
  private triedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;
  private readonly ttlMs: number;
  private readonly maxStaleMs: number;
  private readonly retryMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    readonly url: string,
    options: ExternalKeyStoreOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? TTL_MS;
    this.maxStaleMs = options.maxStaleMs ?? MAX_STALE_MS;
    this.retryMs = options.retryMs ?? RETRY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** The keys to verify with right now: none once the last good read is too old. */
  current(): ReadonlyMap<string, KeyObject> {
    return this.now() - this.loadedAt <= this.maxStaleMs ? this.keys : NO_KEYS;
  }

  /**
   * Re-reads the set when it is older than the refresh interval. Never throws. Concurrent
   * callers share one request, and a failed read is not retried for 5 seconds, so an
   * unreachable auth-service is not also flooded by every request that names a key.
   */
  refresh(): Promise<void> {
    const now = this.now();
    if (now - this.loadedAt < this.ttlMs || now - this.triedAt < this.retryMs) {
      return this.inflight ?? Promise.resolve();
    }
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<void> {
    this.triedAt = this.now();
    try {
      const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return;
      const body = (await res.json()) as { keys?: unknown } | null;
      const next = new Map<string, KeyObject>();
      for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
        const key = ExternalKeyStore.signingKey(jwk);
        if (key) next.set(key.kid, key.key);
      }
      this.keys = next;
      this.loadedAt = this.now();
    } catch {
      // Unreachable or unreadable: the previous set keeps serving until it is too old.
    }
  }

  /** A P-256 signing key with a `kid`, or null. A malformed entry costs only itself. */
  private static signingKey(jwk: unknown): { kid: string; key: KeyObject } | null {
    const k = (jwk ?? {}) as Json;
    if (k.kty !== 'EC' || k.crv !== 'P-256' || typeof k.kid !== 'string') return null;
    if (k.use !== undefined && k.use !== 'sig') return null;
    try {
      const key = createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: k.x as string, y: k.y as string },
        format: 'jwk',
      });
      return { kid: k.kid, key };
    } catch {
      return null;
    }
  }
}

const stores = new Map<string, ExternalKeyStore>();

/** One key store per process for an auth-service address; null when none is configured. */
export function externalKeyStore(authServiceUrl: string | undefined): ExternalKeyStore | null {
  if (!authServiceUrl) return null;
  const url = `${authServiceUrl.replace(/\/+$/, '')}${EXTERNAL_JWKS_PATH}`;
  let store = stores.get(url);
  if (!store) {
    store = new ExternalKeyStore(url);
    stores.set(url, store);
  }
  return store;
}

/** Test seam: forget every key store, as a fresh process would. */
export function resetExternalKeyStores(): void {
  stores.clear();
}

/**
 * The verified caller behind an `Authorization` value, for a rate limiter: counted per
 * ACCOUNT, because every AI-web request arrives from the same address. Answers from the keys
 * already held and only starts a refresh, so a cold store treats the caller as anonymous
 * (the address bucket) for one request rather than waiting on auth-service.
 */
export function verifiedExternalCaller(
  credential: string | undefined,
  authServiceUrl: string | undefined,
): ExternalClaims | null {
  if (!credential) return null;
  // Any case, as JwtAuthGuard accepts it: `bearer <token>` passed the guard but missed the
  // account's bucket and spent the shared address bucket of every AI-web user.
  const token = credential.replace(/^bearer\s+/i, '').trim();
  if (tokenAlgorithm(token) !== EXTERNAL_TOKEN_ALGORITHM) return null;
  const store = externalKeyStore(authServiceUrl);
  if (!store) return null;
  void store.refresh();
  return verifyExternalToken(token, store.current());
}
