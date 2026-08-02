import { applyAdjustment, galonQuantity, percentDiscount } from '../../src/domain/pricing';

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
  it('sums quantities of galon lines only', () => {
    const items = [
      { isGallon: true, quantity: 3 },
      { isGallon: true, quantity: 2 },
      { isGallon: false, quantity: 5 },
      { isGallon: false, quantity: 1 },
    ];
    expect(galonQuantity(items)).toBe(5); // 3 + 2 galons; dus/unit excluded
  });

  it('returns 0 when no galon lines (fee becomes 0)', () => {
    expect(galonQuantity([{ isGallon: false, quantity: 2 }])).toBe(0);
    expect(galonQuantity([])).toBe(0);
  });
});

/**
 * Migration guard for 20260802120000_meter_reading / 0003_product_volume_gallon.
 *
 * galonQuantity used to match the "galon" prefix of the free-text `unit` label and
 * now reads the snapshotted `isGallon` flag. It sets the per-galon DELIVERY FEE, so
 * the backfill must reproduce the old answer exactly on historical rows — a drift
 * here overcharges real customers.
 *
 * The backfill deliberately does NOT use the broader /galon/i-over-unit-or-name rule
 * that report.isGallon used, because the two never agreed. The decisive case is a
 * gallon CAP: unit 'Pak', name 'Tutup Galon'. The report rule counted it as a galon;
 * the fee rule did not. Preserving the fee rule is the safe direction.
 */
describe('galonQuantity vs the label heuristic it replaced', () => {
  const legacyFeeRule = (unit: string): boolean => unit.trim().toLowerCase().startsWith('galon');
  const legacyReportRule = (unit: string, productName: string): boolean =>
    /galon/i.test(unit) || /galon/i.test(productName);
  // Mirrors the migration: lower(btrim(unit)) LIKE 'galon%'
  const backfilled = (unit: string): boolean => legacyFeeRule(unit);

  const catalog = [
    { unit: 'Galon 19L', productName: 'Air Galon 19L', quantity: 3 },
    { unit: '  galon 15L ', productName: 'Le Minerale 15L', quantity: 2 },
    { unit: 'Dus 24x600ml', productName: 'Air Mineral 600ml', quantity: 5 },
    { unit: 'Pak', productName: 'Tutup Galon', quantity: 7 },
    { unit: 'Unit', productName: 'Dispenser', quantity: 1 },
  ];

  it('leaves the delivery-fee basis byte-for-byte unchanged', () => {
    const legacyBasis = catalog
      .filter((l) => legacyFeeRule(l.unit))
      .reduce((s, l) => s + l.quantity, 0);
    const flagged = catalog.map((l) => ({ isGallon: backfilled(l.unit), quantity: l.quantity }));
    expect(galonQuantity(flagged)).toBe(legacyBasis);
    expect(legacyBasis).toBe(5); // 3 + 2 galons; caps, dus and dispenser excluded
  });

  it('is whitespace- and case-insensitive exactly like the old prefix test', () => {
    expect(backfilled('  galon 15L ')).toBe(true);
    expect(backfilled('GALON 19L')).toBe(true);
    expect(backfilled('Pak')).toBe(false);
  });

  it('documents the one place report counts change: a cap is no longer a galon', () => {
    const cap = catalog.find((l) => l.productName === 'Tutup Galon')!;
    expect(legacyReportRule(cap.unit, cap.productName)).toBe(true);
    expect(backfilled(cap.unit)).toBe(false);
  });
});

describe('percentDiscount', () => {
  it('returns the percent of the base', () => {
    expect(percentDiscount(20000, 10)).toBe(2000);
  });
  it('is 0 at 0 percent and full base at 100 percent', () => {
    expect(percentDiscount(20000, 0)).toBe(0);
    expect(percentDiscount(20000, 100)).toBe(20000);
  });
  it('never goes negative', () => {
    expect(percentDiscount(20000, -5)).toBe(0);
  });
});
