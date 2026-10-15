/** Reads one feature flag as admin-service publishes it. */
export interface FeatureFlagReader {
  isEnabled(key: string): Promise<boolean>;
}

const DEFAULT_TTL_MS = 30_000;
const RETRY_AFTER_FAILURE_MS = 10_000;
const TIMEOUT_MS = 2_000;

/**
 * A cached, fail-OPEN read of admin-service's public flag list.
 *
 * Fail-open on purpose: a flag exists to switch a feature OFF, and the platform must keep
 * taking orders when head office's admin console is down. So an unconfigured URL, an
 * unreachable admin-service, a refusal, or a key nobody ever created all answer `true`.
 * One refinement: once a good snapshot has been read, an outage keeps serving that last
 * snapshot instead of snapping every OFF flag back on — the switch head office last
 * flipped is still the best answer available.
 *
 * `enabled` is `state !== OFF` as admin-service computes it; a ROLLOUT percentage is not
 * applied here (there is no stable bucketing identity at these call sites).
 */
export function httpFeatureFlagReader(cfg: {
  adminServiceUrl?: string;
  ttlMs?: number;
  now?: () => number;
}): FeatureFlagReader {
  const ttl = cfg.ttlMs ?? DEFAULT_TTL_MS;
  const now = cfg.now ?? Date.now;
  const base = cfg.adminServiceUrl?.replace(/\/+$/, '');
  let snapshot: Map<string, boolean> | null = null;
  let validUntil = 0;
  let inflight: Promise<void> | null = null;

  async function load(): Promise<void> {
    const url = `${base}/api/v1/feature-flags/public`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const rows = (await res.json()) as { key?: string; enabled?: boolean }[];
      snapshot = new Map(
        rows.filter((r) => typeof r.key === 'string').map((r) => [r.key!, r.enabled !== false]),
      );
      validUntil = now() + ttl;
    } catch {
      // Keep whatever was last known and look again soon; never throw into a checkout.
      validUntil = now() + RETRY_AFTER_FAILURE_MS;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async isEnabled(key) {
      if (!base) return true;
      if (now() >= validUntil) {
        inflight ??= load().finally(() => {
          inflight = null;
        });
        await inflight;
      }
      return snapshot?.get(key) ?? true;
    },
  };
}
