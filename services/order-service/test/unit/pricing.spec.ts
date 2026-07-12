import { applyAdjustment, galonQuantity } from '../../src/domain/pricing';

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

describe('galonQuantity (per-galon delivery fee basis)', () => {
  it('sums quantities of galon-unit lines only', () => {
    const items = [
      { unit: 'Galon 19L', quantity: 3 },
      { unit: 'Galon 15L', quantity: 2 },
      { unit: 'Dus 24x600ml', quantity: 5 },
      { unit: 'Unit', quantity: 1 },
    ];
    expect(galonQuantity(items)).toBe(5); // 3 + 2 galons; dus/unit excluded
  });

  it('is case- and whitespace-insensitive on the unit prefix', () => {
    expect(galonQuantity([{ unit: '  galon 19L ', quantity: 4 }])).toBe(4);
  });

  it('returns 0 when no galon lines (fee becomes 0)', () => {
    expect(galonQuantity([{ unit: 'Pak', quantity: 2 }])).toBe(0);
    expect(galonQuantity([])).toBe(0);
  });
});
