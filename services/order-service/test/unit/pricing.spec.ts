import { applyAdjustment } from '../../src/domain/pricing';

describe('applyAdjustment', () => {
  it('returns the base unchanged when there is no adjustment', () => {
    expect(applyAdjustment(15000, null)).toBe(15000);
  });

  it('applies a percentage discount', () => {
    expect(applyAdjustment(20000, { adjustType: 'PERCENT', value: -10 })).toBe(18000);
  });

  it('applies a percentage surge', () => {
    expect(applyAdjustment(20000, { adjustType: 'PERCENT', value: 5 })).toBe(21000);
  });

  it('applies a fixed delta', () => {
    expect(applyAdjustment(20000, { adjustType: 'FIXED', value: -2000 })).toBe(18000);
  });

  it('clamps to zero (never negative)', () => {
    expect(applyAdjustment(1500, { adjustType: 'FIXED', value: -3000 })).toBe(0);
  });
});
