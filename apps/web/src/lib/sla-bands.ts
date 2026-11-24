'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';

/**
 * HD-6 #19: the one SLA colour band every screen shares - the policy HQ saves at
 * /hq/sla-policy (healthy from `healthy`%, critical below `critical`%). Falls back to the
 * policy defaults (95 / 85) until it loads and whenever it cannot be read.
 */
export interface SlaBands {
  healthy: number;
  critical: number;
}

export const DEFAULT_SLA_BANDS: SlaBands = { healthy: 95, critical: 85 };

/** `pct` is 0-100. Anything under the critical band needs attention. */
export const isSlaCritical = (pct: number, bands: SlaBands = DEFAULT_SLA_BANDS): boolean =>
  pct < bands.critical;

const TTL_MS = 5 * 60_000;
let cache: { bands: SlaBands; at: number } | null = null;
let inflight: Promise<SlaBands> | null = null;

/** One read per five minutes for the whole app; never throws. */
export function loadSlaBands(): Promise<SlaBands> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.bands);
  inflight ??= api
    .get<{ healthyBandPct: number; criticalBandPct: number }>(endpoints.admin.slaBands, true)
    .then((r) => {
      const ok =
        Number.isFinite(r.healthyBandPct) &&
        Number.isFinite(r.criticalBandPct) &&
        r.criticalBandPct <= r.healthyBandPct;
      const bands = ok
        ? { healthy: r.healthyBandPct, critical: r.criticalBandPct }
        : DEFAULT_SLA_BANDS;
      cache = { bands, at: Date.now() };
      return bands;
    })
    .catch(() => {
      // A role without the dashboard capability (403) must not retry on every mount.
      cache = { bands: DEFAULT_SLA_BANDS, at: Date.now() };
      return DEFAULT_SLA_BANDS;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function resetSlaBandsCache(): void {
  cache = null;
  inflight = null;
}

export function useSlaBands(): SlaBands {
  const [bands, setBands] = useState<SlaBands>(cache?.bands ?? DEFAULT_SLA_BANDS);
  useEffect(() => {
    let alive = true;
    void loadSlaBands().then((b) => alive && setBands(b));
    return () => {
      alive = false;
    };
  }, []);
  return bands;
}
