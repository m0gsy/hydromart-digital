import {
  MeterReading,
  SoldTotals,
  litersBetween,
  reconcile,
  sumSoldLiters,
} from '../../src/domain/meter-reading';

function reading(over: Partial<MeterReading> = {}): MeterReading {
  return {
    depotId: 'd1',
    date: '2026-08-02',
    openingM3: 1000,
    closingM3: 1002.6,
    sourceOpeningM3: null,
    sourceClosingM3: null,
    openedBy: 'staff-1',
    openedAt: new Date('2026-08-02T01:00:00.000Z'),
    closedBy: 'staff-1',
    closedAt: new Date('2026-08-02T12:00:00.000Z'),
    alertedAt: null,
    note: null,
    ...over,
  };
}

function totals(over: Partial<SoldTotals> = {}): SoldTotals {
  return { soldLiters: 0, unmeasuredLines: 0, gallonsDelivered: 0, revenueIdr: 0, ...over };
}

const settings = { referenceVolumeMl: 19000, toleranceLiters: 200 };

describe('sumSoldLiters', () => {
  it("sums a mixed 19L/15L day the way an operator counts it", () => {
    // The worked example from the request: 120 galon x 19L + 10 Le Minerale x 15L.
    const { soldLiters, unmeasuredLines } = sumSoldLiters([
      { quantity: 120, volumeMl: 19000 },
      { quantity: 10, volumeMl: 15000 },
    ]);
    expect(soldLiters).toBe(2430);
    expect(unmeasuredLines).toBe(0);
  });

  it('reports unmeasured lines instead of counting them as zero litres', () => {
    const { soldLiters, unmeasuredLines } = sumSoldLiters([
      { quantity: 100, volumeMl: 19000 },
      { quantity: 5, volumeMl: null },
      { quantity: 2, volumeMl: null },
    ]);
    expect(soldLiters).toBe(1900);
    expect(unmeasuredLines).toBe(2);
  });

  it('is zero for an empty day', () => {
    expect(sumSoldLiters([])).toEqual({ soldLiters: 0, unmeasuredLines: 0 });
  });
});

describe('litersBetween', () => {
  it('converts a m³ pair to litres', () => {
    expect(litersBetween(1000, 1002.6)).toBe(2600);
  });

  it('is null while the closing reading is missing', () => {
    expect(litersBetween(1000, null)).toBeNull();
  });

  it('does not leak float noise into the reported figure', () => {
    expect(litersBetween(1000.1, 1000.3)).toBe(200);
  });
});

describe('reconcile', () => {
  it('reports the gap between water out and water sold, in litres, galon and rupiah', () => {
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading(),
      totals: totals({ soldLiters: 2430, gallonsDelivered: 130, revenueIdr: 2600000 }),
      ...settings,
    });
    expect(result.meterLiters).toBe(2600);
    expect(result.varianceLiters).toBe(170);
    expect(result.varianceGallons).toBe(8.95); // 170 / 19
    expect(result.varianceIdr).toBe(179000); // 8.95 x (2_600_000 / 130)
    expect(result.overTolerance).toBe(false); // 170 <= 200
  });

  it('is not comparable yet when only the opening reading exists', () => {
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading({ closingM3: null, closedBy: null, closedAt: null }),
      totals: totals({ soldLiters: 2430 }),
      ...settings,
    });
    expect(result.meterLiters).toBeNull();
    expect(result.varianceLiters).toBeNull();
    expect(result.varianceGallons).toBeNull();
    expect(result.varianceIdr).toBeNull();
    expect(result.overTolerance).toBe(false);
    // The sales side is still reported — the operator can see it before closing.
    expect(result.soldLiters).toBe(2430);
  });

  it('reports no reading at all as an empty, non-alerting day', () => {
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: null,
      totals: totals(),
      ...settings,
    });
    expect(result.reading).toBeNull();
    expect(result.meterLiters).toBeNull();
    expect(result.overTolerance).toBe(false);
  });

  it('leaves the rupiah figure null when no galon was delivered, never zero', () => {
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading(),
      totals: totals({ soldLiters: 0, gallonsDelivered: 0, revenueIdr: 0 }),
      ...settings,
    });
    expect(result.varianceLiters).toBe(2600);
    expect(result.varianceIdr).toBeNull();
    // and the alert still works on a day with no revenue, because it is litre-based
    expect(result.overTolerance).toBe(true);
  });

  it('reports a negative variance rather than clamping it', () => {
    // Sales claim more water than the meter saw: a mis-keyed dial or a slow meter.
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading({ closingM3: 1001 }),
      totals: totals({ soldLiters: 2430, gallonsDelivered: 130, revenueIdr: 2600000 }),
      ...settings,
    });
    expect(result.meterLiters).toBe(1000);
    expect(result.varianceLiters).toBe(-1430);
    expect(result.varianceIdr).toBeLessThan(0);
    expect(result.overTolerance).toBe(true); // absolute value crosses the threshold
  });

  it('carries the unmeasured-line count through so the UI can qualify the number', () => {
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading(),
      totals: totals({ soldLiters: 1900, unmeasuredLines: 3, gallonsDelivered: 100 }),
      ...settings,
    });
    expect(result.unmeasuredLines).toBe(3);
  });

  it('honours a depot whose reference galon is 15L', () => {
    const result = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading(),
      totals: totals({ soldLiters: 2450 }),
      referenceVolumeMl: 15000,
      toleranceLiters: 200,
    });
    expect(result.varianceLiters).toBe(150);
    expect(result.varianceGallons).toBe(10); // 150 / 15
  });

  describe('RO recovery', () => {
    it('is the treated-over-raw percentage when both meters are read', () => {
      const result = reconcile({
        depotId: 'd1',
        date: '2026-08-02',
        reading: reading({ sourceOpeningM3: 500, sourceClosingM3: 504 }),
        totals: totals({ soldLiters: 2430 }),
        ...settings,
      });
      expect(result.roYieldPct).toBe(65); // 2600 / 4000
    });

    it('is null when the raw-water meter was not read', () => {
      const result = reconcile({
        depotId: 'd1',
        date: '2026-08-02',
        reading: reading({ sourceOpeningM3: 500, sourceClosingM3: null }),
        totals: totals(),
        ...settings,
      });
      expect(result.roYieldPct).toBeNull();
    });

    it('is null rather than a division by zero when the raw meter did not move', () => {
      const result = reconcile({
        depotId: 'd1',
        date: '2026-08-02',
        reading: reading({ sourceOpeningM3: 500, sourceClosingM3: 500 }),
        totals: totals(),
        ...settings,
      });
      expect(result.roYieldPct).toBeNull();
    });

    it('is null while the production meter itself is still open', () => {
      const result = reconcile({
        depotId: 'd1',
        date: '2026-08-02',
        reading: reading({ closingM3: null, sourceOpeningM3: 500, sourceClosingM3: 504 }),
        totals: totals(),
        ...settings,
      });
      expect(result.roYieldPct).toBeNull();
    });
  });

  it('trips the tolerance strictly above the threshold, not at it', () => {
    const at = reconcile({
      depotId: 'd1',
      date: '2026-08-02',
      reading: reading({ closingM3: 1000.2 }),
      totals: totals(),
      ...settings,
    });
    expect(at.varianceLiters).toBe(200);
    expect(at.overTolerance).toBe(false);
  });
});
