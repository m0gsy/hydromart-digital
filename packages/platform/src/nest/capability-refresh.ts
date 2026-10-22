import {
  loadCustomRoles,
  loadDepotOverrides,
  loadOverrides,
  loadRoleSettings,
  type CapabilityOverrides,
  type CustomRoleDef,
  type DepotOverride,
  type RoleSetting,
} from '@hydromart/access';

const DEFAULT_TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;
/** PLAT-6: how long a snapshot may outlive the source that produced it. */
const DEFAULT_MAX_STALE_MS = 5 * 60_000;

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

/**
 * Everything a service needs to answer `can()`: the matrix patch, the active custom roles and
 * the per-depot exceptions. A loader may still return a bare patch (older sources, tests);
 * that is read as "no custom roles, no depot overrides".
 */
export interface CapabilitySnapshot {
  overrides: CapabilityOverrides;
  customRoles: readonly CustomRoleDef[];
  depotOverrides: readonly DepotOverride[];
  roleSettings?: readonly RoleSetting[];
}

function isSnapshot(x: CapabilitySnapshot | CapabilityOverrides): x is CapabilitySnapshot {
  const c = x as Partial<CapabilitySnapshot>;
  return Array.isArray(c.customRoles) && Array.isArray(c.depotOverrides);
}

function apply(next: CapabilitySnapshot | CapabilityOverrides): number {
  const snap: CapabilitySnapshot = isSnapshot(next)
    ? next
    : { overrides: next, customRoles: [], depotOverrides: [], roleSettings: [] };
  loadOverrides(snap.overrides);
  loadCustomRoles(snap.customRoles);
  loadDepotOverrides(snap.depotOverrides);
  loadRoleSettings(snap.roleSettings ?? []);
  return Object.keys(snap.overrides).length;
}

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
 *
 * PLAT-6 — that trade used to be written as "for up to one TTL after an outage a revoked
 * permission may still work", and the code did not keep the promise: a source down for a
 * week served the week-old snapshot for a week. A permission revoked because somebody
 * should no longer hold it is exactly the case where an outage must not extend it
 * indefinitely.
 *
 * So staleness is bounded: after `maxStaleMs` without a successful load the snapshot is
 * dropped and the service falls back to the compiled default matrix — the same policy a
 * fresh boot would serve. Overrides that GRANT something extra are lost with it, which is
 * the right direction to fail: back to the policy shipped in the binary, not forward to
 * one nobody can refresh.
 *
 * Never throws and never rejects, so a caller can fire it from bootstrap without a
 * catch. Returns a stop() for tests and shutdown.
 */
export function startCapabilityRefresh(
  load: () => Promise<CapabilitySnapshot | CapabilityOverrides>,
  opts: { ttlMs?: number; maxStaleMs?: number; logger?: RefreshLogger } = {},
): () => void {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxStaleMs = opts.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const logger = opts.logger;
  let failing = false;
  let stopped = false;

  let loadedOnce = false;

  const tick = async (): Promise<void> => {
    try {
      const count = apply(await load());
      lastLoad = { at: Date.now(), overrides: count };
      refreshFailing = false;
      if (!loadedOnce) {
        loadedOnce = true;
        // One line at boot naming the snapshot size. A service whose wiring was missed
        // never prints it, which is the difference between spotting the gap in five
        // seconds and finding it in a support ticket weeks later.
        logger?.log?.(`Capability matrix loaded (${count} override(s)).`);
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
      // PLAT-6: the snapshot expires even though the source cannot say so.
      const age = lastLoad ? Date.now() - lastLoad.at : Number.POSITIVE_INFINITY;
      if (lastLoad && age > maxStaleMs && lastLoad.overrides > 0) {
        apply({});
        lastLoad = { at: lastLoad.at, overrides: 0 };
        logger?.warn(
          `Capability overrides are ${Math.round(age / 1000)}s stale; falling back to the ` +
            'compiled default matrix until the source answers again.',
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
}): () => Promise<CapabilitySnapshot> {
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
      return sanitize((await res.json()) as RawSnapshot);
    } finally {
      clearTimeout(timeout);
    }
  };
}

interface RawSnapshot {
  overrides?: unknown;
  customRoles?: unknown;
  depotOverrides?: unknown;
  roleSettings?: unknown;
}

const SCOPES = new Set(['LOCKED', 'RESOLVED', 'GLOBAL']);
const EFFECTS = new Set(['GRANT', 'DENY']);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Keep only well-formed entries and drop prototype keys. The payload crosses a network
 * boundary, and it decides who may do what — a malformed entry must not become a permission.
 * A malformed custom role or depot override is DROPPED, never defaulted: dropping a role
 * leaves its holders with nothing, and dropping an exception falls back to the global matrix.
 */
function sanitize(body: RawSnapshot | null): CapabilitySnapshot {
  // `?.` because a literal `null` JSON body is a valid response and would otherwise
  // throw here rather than degrade to "no overrides".
  const raw = body?.overrides;
  const out: Record<string, readonly string[]> = Object.create(null) as Record<
    string,
    readonly string[]
  >;
  if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (BAD_KEYS.has(key)) continue;
      if (!Array.isArray(value)) continue;
      out[key] = value.filter((r): r is string => typeof r === 'string');
    }
  }

  const customRoles: CustomRoleDef[] = [];
  if (Array.isArray(body?.customRoles)) {
    for (const r of body.customRoles as Array<Record<string, unknown> | null>) {
      if (
        r &&
        typeof r.key === 'string' &&
        r.key.startsWith('C_') &&
        typeof r.name === 'string' &&
        typeof r.scope === 'string' &&
        SCOPES.has(r.scope)
      ) {
        customRoles.push({ key: r.key, name: r.name, scope: r.scope as CustomRoleDef['scope'] });
      }
    }
  }

  const depotOverrides: DepotOverride[] = [];
  if (Array.isArray(body?.depotOverrides)) {
    for (const o of body.depotOverrides as Array<Record<string, unknown> | null>) {
      if (
        o &&
        typeof o.capability === 'string' &&
        !BAD_KEYS.has(o.capability) &&
        typeof o.roleKey === 'string' &&
        typeof o.depotId === 'string' &&
        typeof o.effect === 'string' &&
        EFFECTS.has(o.effect)
      ) {
        depotOverrides.push({
          capability: o.capability,
          roleKey: o.roleKey,
          depotId: o.depotId,
          effect: o.effect as DepotOverride['effect'],
        });
      }
    }
  }

  const roleSettings: RoleSetting[] = [];
  if (Array.isArray(body?.roleSettings)) {
    for (const r of body.roleSettings as Array<Record<string, unknown> | null>) {
      if (!r || typeof r.roleKey !== 'string' || BAD_KEYS.has(r.roleKey)) continue;
      roleSettings.push({
        roleKey: r.roleKey,
        name: typeof r.name === 'string' ? r.name : null,
        description: typeof r.description === 'string' ? r.description : null,
        scope: typeof r.scope === 'string' && SCOPES.has(r.scope) ? (r.scope as CustomRoleDef['scope']) : null,
        disabled: r.disabled === true,
      });
    }
  }
  return { overrides: out, customRoles, depotOverrides, roleSettings };
}
