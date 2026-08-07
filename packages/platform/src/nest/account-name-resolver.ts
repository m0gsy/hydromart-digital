/** Account ids → display names, as auth-service records them. Absent id = no account. */
export type AccountNameResolver = (ids: string[]) => Promise<Map<string, string>>;

/** auth-service caps one lookup at 200 ids; a queue can hold more than that. */
const BATCH = 200;
const TIMEOUT_MS = 5_000;

/**
 * Resolve account ids to names through auth-service's internal by-ids route, so a list
 * can render "Budi" where it used to render a 36-character UUID (§G-3).
 *
 * It lives here rather than in one service because six consoles needed the same call, and
 * because the accounts table is auth-service's alone — a service keeping its own copy of a
 * name would be showing whatever the name was on the day the row was written.
 *
 * Fails SOFT, always: this only decorates a payload the caller can already render. An
 * unreachable auth-service costs the names, never the list. The one thing it must not do
 * is turn a working refund queue into a 503 because a decoration failed.
 *
 * Works for staff and customers alike — both are rows in the same accounts table, which is
 * why the same resolver serves `requestedByName` and `customerName`.
 */
export function httpAccountNameResolver(cfg: {
  authServiceUrl?: string;
  internalKey?: string;
}): AccountNameResolver {
  return async (ids) => {
    const out = new Map<string, string>();
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
    if (!cfg.authServiceUrl || !cfg.internalKey || unique.length === 0) return out;

    const url = `${cfg.authServiceUrl.replace(/\/$/, '')}/api/v1/auth/internal/customers/by-ids`;
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-key': cfg.internalKey },
          body: JSON.stringify({ ids: batch }),
          signal: controller.signal,
        });
        if (!res.ok) continue;
        const rows = (await res.json()) as { id?: string; fullName?: string | null }[];
        for (const r of rows) {
          if (r.id && r.fullName) out.set(r.id, r.fullName);
        }
      } catch {
        // Degrade this batch to "no name". The caller keeps whatever fallback it had.
      } finally {
        clearTimeout(timer);
      }
    }
    return out;
  };
}
