import { loadOverrides, type CapabilityOverrides, type Role } from '@hydromart/access';

const DEFAULT_TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;

/**
 * What the last successful load produced. `null` means this process has never loaded the
 * matrix — a service whose bootstrap missed `startCapabilityRefresh` sits here forever,
 * serving compiled defaults, and that is exactly the state /health has to expose.
 */
let lastLoad: { at: number; overrides: number } | null = null;

export interface CapabilityMatrixStatus {
  /** Overrides in force, or null when this process has never loaded them. */
  overrides: number | null;
  /** Seconds since the last successful load; null when there has never been one. */
  ageSeconds: number | null;
  /** True once a load has failed and no later one has succeeded. */
  stale: boolean;
}

let refreshFailing = false;

export function capabilityMatrixStatus(): CapabilityMatrixStatus {
  if (!lastLoad) {
    return { overrides: null, ageSeconds: null, stale: refreshFailing };
  }
  return {
    overrides: lastLoad.overrides,
    ageSeconds: Math.round((Date.now() - lastLoad.at) / 1000),
    stale: refreshFailing,
  };
}

/** Test/shutdown hook — the module-level snapshot outlives a single Nest app otherwise. */
export function resetCapabilityRefreshStatus(): void {
  lastLoad = null;
  refreshFailing = false;
}

interface RefreshLogger {
  log?(message: string): void;
  warn(message: string): void;
}

/**
 * Poll a source of capability overrides into the live map in @hydromart/access.
 *
 * Deliberately fail-OPEN, the opposite of the depot-scope resolver: an unreachable
 * source leaves the last good snapshot in place (an empty one at boot), and an empty
 * snapshot IS the compiled default matrix. So a wobble in the override source degrades
 * to the policy shipped in the binary instead of locking every service out of itself.
 * The trade is explicit: for up to one TTL after an outage a revoked permission may
 * still work.
 *
 * Never throws and never rejects, so a caller can fire it from bootstrap without a
 * catch. Returns a stop() for tests and shutdown.
 */
export function startCapabilityRefresh(
  load: () => Promise<CapabilityOverrides>,
  opts: { ttlMs?: number; logger?: RefreshLogger } = {},
): () => void {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const logger = opts.logger;
  let failing = false;
  let stopped = false;

  let loadedOnce = false;

  const tick = async (): Promise<void> => {
    try {
      const next = await load();
      loadOverrides(next);
      lastLoad = { at: Date.now(), overrides: Object.keys(next).length };
      refreshFailing = false;
      if (!loadedOnce) {
        loadedOnce = true;
        // One line at boot naming the snapshot size. A service whose wiring was missed
        // never prints it, which is the difference between spotting the gap in five
        // seconds and finding it in a support ticket weeks later.
        logger?.log?.(`Capability matrix loaded (${Object.keys(next).length} override(s)).`);
      } else if (failing) {
        logger?.log?.('Capability overrides refreshed again.');
      }
      failing = false;
    } catch (err) {
      // One line per failure STREAK, not per tick: a source down for an hour would
      // otherwise write 120 identical lines and bury everything else.
      refreshFailing = true;
      if (!failing) {
        failing = true;
        logger?.warn(
          `Capability overrides unavailable, serving the last known matrix: ${String(err)}`,
        );
      }
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), ttlMs);
  // Do not hold the event loop open on a service that is shutting down.
  timer.unref?.();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Reads the override patch from auth-service (INTERNAL_SERVICE_KEY auth). Mirrors the
 * DepotOwnershipHttpAdapter shape, but throws plain Errors: the refresher above decides
 * what a failure means, and here it means "keep the last snapshot".
 */
export function httpCapabilityLoader(cfg: {
  authServiceUrl?: string;
  internalKey?: string;
}): () => Promise<CapabilityOverrides> {
  return async () => {
    if (!cfg.authServiceUrl || !cfg.internalKey) {
      throw new Error('capability override source is not configured');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${cfg.authServiceUrl}/api/v1/access/internal/overrides`, {
        headers: { 'x-internal-key': cfg.internalKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return sanitize((await res.json()) as { overrides?: unknown });
    } finally {
      clearTimeout(timeout);
    }
  };
}

/**
 * Keep only well-formed `capability -> string[]` entries and drop prototype keys. The
 * payload crosses a network boundary, and it decides who may do what — a malformed
 * entry must not become a permission.
 */
function sanitize(body: { overrides?: unknown } | null): CapabilityOverrides {
  // `?.` because a literal `null` JSON body is a valid response and would otherwise
  // throw here rather than degrade to "no overrides".
  const raw = body?.overrides;
  if (raw === null || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, readonly Role[]> = Object.create(null) as Record<
    string,
    readonly Role[]
  >;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!Array.isArray(value)) continue;
    out[key] = value.filter((r): r is Role => typeof r === 'string');
  }
  return out;
}
