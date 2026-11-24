import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

import {
  DEFAULT_SLA_BANDS,
  isSlaCritical,
  loadSlaBands,
  resetSlaBandsCache,
} from '../src/lib/sla-bands';

describe('shared SLA colour band (HD-6 #19)', () => {
  beforeEach(() => {
    get.mockReset();
    resetSlaBandsCache();
  });

  it('defaults to the policy defaults: healthy from 95, critical below 85', () => {
    expect(DEFAULT_SLA_BANDS).toEqual({ healthy: 95, critical: 85 });
  });

  it('is critical strictly below the critical band', () => {
    expect(isSlaCritical(84.9)).toBe(true);
    expect(isSlaCritical(85)).toBe(false);
    expect(isSlaCritical(79, { healthy: 90, critical: 80 })).toBe(true);
    expect(isSlaCritical(80, { healthy: 90, critical: 80 })).toBe(false);
  });

  it('reads the saved policy bands once and caches them', async () => {
    get.mockResolvedValue({ healthyBandPct: 90, criticalBandPct: 70 });
    expect(await loadSlaBands()).toEqual({ healthy: 90, critical: 70 });
    expect(await loadSlaBands()).toEqual({ healthy: 90, critical: 70 });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('falls back to 95/85 when the read fails or the bands are nonsense', async () => {
    get.mockRejectedValueOnce(new Error('403'));
    expect(await loadSlaBands()).toEqual(DEFAULT_SLA_BANDS);
    resetSlaBandsCache();
    get.mockResolvedValueOnce({ healthyBandPct: 60, criticalBandPct: 80 });
    expect(await loadSlaBands()).toEqual(DEFAULT_SLA_BANDS);
  });

  it('caches the fallback after a failure, so a 403 is not retried on every mount', async () => {
    get.mockRejectedValue(new Error('403'));
    expect(await loadSlaBands()).toEqual(DEFAULT_SLA_BANDS);
    expect(await loadSlaBands()).toEqual(DEFAULT_SLA_BANDS);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight read between concurrent callers', async () => {
    get.mockResolvedValue({ healthyBandPct: 90, criticalBandPct: 70 });
    await Promise.all([loadSlaBands(), loadSlaBands()]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
