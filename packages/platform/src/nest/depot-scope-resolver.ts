import { ServiceUnavailableException } from '@nestjs/common';

import { Role } from '../domain/role.enum';

type Resolve = (staffId: string, role: Role) => Promise<string[]>;

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_STALE_ON_ERROR_MS = 600_000;
const TIMEOUT_MS = 5_000;

interface Entry {
  ids: string[];
  expires: number;
  /** How long this entry may keep serving once refreshing it starts failing. */
  staleUntil: number;
}

let resolve: Resolve | null = null;
let ttlMs = DEFAULT_TTL_MS;
let staleOnErrorMs = DEFAULT_STALE_ON_ERROR_MS;
let warnedUnconfigured = false;
/*
 * The clock, injectable — because a TTL asserted against the real one is a coin flip.
 *
 * The cache test configured a 20 ms TTL and made two calls back to back, expecting one
 * resolve. On a loaded runner under coverage instrumentation those two calls were more than
 * 20 ms apart, the entry had expired, and it resolved twice. Nothing was wrong with the
 * code; the test was measuring the runner. It went red on main, which is the expensive way
 * to find out.
 */
let clock: () => number = Date.now;
// ponytail: unbounded Map — one entry per active supervisor/owner (dozens, not millions).
// Swap for an LRU if these roles ever pass ~10k accounts.
const cache = new Map<string, Entry>();

/**
 * Configure how a multi-depot caller's depot set is resolved. Called once from bootstrap;
 * deliberately NOT dependency injection, so DepotScopeGuard keeps its Reflector-only
 * constructor and the twelve APP_GUARD registrations stay untouched.
 */
export function configureDepotScope(
  fn: Resolve,
  opts: { ttlMs?: number; staleOnErrorMs?: number; now?: () => number } = {},
): void {
  resolve = fn;
  ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  staleOnErrorMs = opts.staleOnErrorMs ?? DEFAULT_STALE_ON_ERROR_MS;
  clock = opts.now ?? Date.now;
  cache.clear();
}

/** Drop the resolver and its cache (tests, shutdown). */
export function resetDepotScope(): void {
  resolve = null;
  warnedUnconfigured = false;
  clock = Date.now;
  cache.clear();
}

export interface DepotScopeStatus {
  /** False = bootstrap never called configureDepotScope. Multi-depot roles see one depot. */
  configured: boolean;
  /** Accounts whose depot set is currently cached (dozens at most). */
  cached: number;
}

/**
 * Whether this process can resolve a multi-depot scope at all.
 *
 * `configured: false` is the failure worth surfacing: it throws nothing and denies
 * nothing — it quietly narrows every supervisor to their own token depot, which looks
 * like a data problem rather than a wiring one.
 */
export function depotScopeStatus(): DepotScopeStatus {
  return { configured: resolve !== null, cached: cache.size };
}

/**
 * The depots this caller is responsible for.
 *
 * Fails CLOSED, unlike the capability refresher: there is no safe default here. An empty
 * set would deny anyway, and a wildcard would be a tenant-isolation breach — so an
 * unreachable depot-service is a 503, not a guess.
 *
 * The one concession is stale-on-error: while refreshing fails, an entry that was
 * previously verified keeps serving for up to `staleOnErrorMs`. The system never invents
 * access, it only re-serves access it has already confirmed.
 */
export async function resolveDepotScope(staffId: string, role: Role): Promise<string[] | null> {
  if (!resolve) {
    // NOT configured is a wiring mistake, not an outage: there is no hierarchy to consult,
    // so report "unknown" and let the caller fall back to the token's own depot. Warn once
    // so a service whose bootstrap missed the call is visible rather than silently narrow.
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      // eslint-disable-next-line no-console
      console.warn('[depot-scope] resolver not configured — multi-depot roles see only their own depot.');
    }
    return null;
  }
  const now = clock();
  const cached = cache.get(staffId);
  if (cached && cached.expires > now) {
    return cached.ids;
  }
  try {
    const ids = await resolve(staffId, role);
    cache.set(staffId, { ids, expires: now + ttlMs, staleUntil: now + staleOnErrorMs });
    return ids;
  } catch (err) {
    if (cached && cached.staleUntil > now) {
      // Ride out the blip on the last confirmed answer rather than locking a supervisor
      // out mid-shift. staleUntil is NOT extended, so a long outage still expires it.
      cached.expires = now + ttlMs;
      return cached.ids;
    }
    if (err instanceof ServiceUnavailableException) {
      throw err;
    }
    throw new ServiceUnavailableException('Depot scope lookup failed.');
  }
}

/**
 * HTTP resolver for the services that do not own the hierarchy. Mirrors
 * DepotOwnershipHttpAdapter: internal-key auth, hard timeout, fail closed.
 */
export function httpDepotScopeResolver(cfg: {
  depotServiceUrl?: string;
  internalKey?: string;
}): Resolve {
  return async (staffId, role) => {
    if (!cfg.depotServiceUrl || !cfg.internalKey) {
      throw new ServiceUnavailableException('Depot scope lookup is not configured.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = `${cfg.depotServiceUrl}/api/v1/staff-hierarchy/internal/scope/${staffId}?role=${encodeURIComponent(role)}`;
      const res = await fetch(url, {
        headers: { 'x-internal-key': cfg.internalKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException('Depot scope lookup failed.');
      }
      const body = (await res.json()) as { depotIds?: unknown };
      return Array.isArray(body.depotIds)
        ? body.depotIds.filter((d): d is string => typeof d === 'string')
        : [];
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Depot scope lookup failed.');
    } finally {
      clearTimeout(timeout);
    }
  };
}
