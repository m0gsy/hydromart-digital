import { describe, expect, it } from 'vitest';
import { evaluateReseller } from '../src/lib/reseller';

const asOf = new Date('2026-07-31T00:00:00Z');

describe('evaluateReseller', () => {
  it('computes attainment + tercapai status', () => {
    const m = evaluateReseller({ volumeQty: 100, prevVolumeQty: 80, monthlyTargetQty: 100, lastOrderAt: '2026-07-20T00:00:00Z', asOf });
    expect(m.attainmentPct).toBe(100);
    expect(m.status).toBe('tercapai');
    expect(m.growthPct).toBe(25);
    expect(m.pasif).toBe(false);
  });

  it('flags lampaui at >=120% and positive growth from zero', () => {
    const m = evaluateReseller({ volumeQty: 60, prevVolumeQty: 0, monthlyTargetQty: 50, lastOrderAt: '2026-07-25T00:00:00Z', asOf });
    expect(m.status).toBe('lampaui');
    expect(m.growthPct).toBe(100);
  });

  it('reports no-target and never divides when target is 0', () => {
    const m = evaluateReseller({ volumeQty: 30, prevVolumeQty: 10, monthlyTargetQty: 0, lastOrderAt: '2026-07-25T00:00:00Z', asOf });
    expect(m.attainmentPct).toBeNull();
    expect(m.status).toBe('no-target');
  });

  it('marks di-bawah and pasif when stale / never ordered', () => {
    const m = evaluateReseller({ volumeQty: 10, prevVolumeQty: 40, monthlyTargetQty: 100, lastOrderAt: null, asOf });
    expect(m.status).toBe('di-bawah');
    expect(m.growthPct).toBe(-75);
    expect(m.pasif).toBe(true);
  });
});
