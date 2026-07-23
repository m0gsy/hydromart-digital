export type SettingType = 'int' | 'number' | 'money' | 'string';

export interface SettingRow {
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
  key: string;
  value: string;
}

/** How a service hands its full row set (all GLOBAL + DEPOT) to the cache. */
export interface SettingsSource {
  loadAll(): Promise<SettingRow[]>;
}

export function coerce(raw: string, type: SettingType): number | string {
  if (type === 'string') {
    return raw;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) {
    // A malformed stored value must not poison config; caller's envDefault wins upstream.
    return 0;
  }
  return type === 'int' || type === 'money' ? Math.trunc(n) : n;
}

/** depot override ?? global ?? null (never the env default — that is the caller's job). */
export function resolveRaw(key: string, depotId: string | null, rows: SettingRow[]): string | null {
  if (depotId != null) {
    const depot = rows.find((r) => r.scope === 'DEPOT' && r.depotId === depotId && r.key === key);
    if (depot) {
      return depot.value;
    }
  }
  const global = rows.find((r) => r.scope === 'GLOBAL' && r.key === key);
  return global ? global.value : null;
}

/**
 * In-memory snapshot of one service's settings rows, intended to be refreshed by the
 * caller on the `ttl` cadence. Keeps the config getters synchronous: they read the
 * last snapshot, never hit the DB inline.
 * Empty snapshot (pre-first-refresh or empty table) ⇒ every effective() returns the
 * env default, i.e. today's behavior.
 */
export class SettingsCache {
  private rows: SettingRow[] = [];

  constructor(
    private readonly source: SettingsSource,
    private readonly ttlMs = 30_000,
  ) {}

  async refresh(): Promise<void> {
    this.rows = await this.source.loadAll();
  }

  get ttl(): number {
    return this.ttlMs;
  }

  getRaw(key: string, depotId: string | null): string | null {
    return resolveRaw(key, depotId, this.rows);
  }

  effective(
    key: string,
    type: SettingType,
    envDefault: number | string,
    depotId: string | null = null,
  ): number | string {
    const raw = resolveRaw(key, depotId, this.rows);
    if (raw == null) {
      return envDefault;
    }
    // A row exists but its value is garbage (e.g. non-numeric 'money'): treat it as if
    // the row didn't exist rather than silently coercing to 0 (coerce()'s own belt-and-
    // suspenders default).
    if ((type === 'int' || type === 'number' || type === 'money') && Number.isNaN(Number(raw))) {
      return envDefault;
    }
    return coerce(raw, type);
  }
}
