import { DashboardService } from '../../src/application/services/dashboard.service';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';
import { InMemoryDashboardSources } from '../support/fakes';

const DEPOT_ID = '11111111-1111-4111-8111-111111111111';

const pnlSources = (
  options: {
    orderDown?: boolean;
    depotDown?: boolean;
    partialCogs?: boolean;
    unverifiedProcurement?: boolean;
  } = {},
) =>
  ({
    depotMonthly: jest.fn().mockResolvedValue(
      options.orderDown
        ? null
        : { depotId: DEPOT_ID, month: '2026-07', orders: 12, revenueIdr: 1_000_000 },
    ),
    operationalCosts: jest.fn().mockResolvedValue(
      options.depotDown
        ? null
        : {
            depotId: DEPOT_ID,
            from: '2026-07-01T00:00:00.000Z',
            to: '2026-08-01T00:00:00.000Z',
            reportType: 'OPERATIONAL_MANAGEMENT',
            disclaimer: 'Operational management report only; not statutory accounting or a tax statement.',
            cogs: {
              amountIdr: options.partialCogs ? null : 400_000,
              coveredAmountIdr: options.partialCogs ? 250_000 : 400_000,
              totalUnits: 100,
              coveredUnits: options.partialCogs ? 60 : 100,
              uncoveredUnits: options.partialCogs ? 40 : 0,
              status: options.partialCogs ? 'partial' : 'complete',
              valuationMethod: 'LATEST_RECEIVED_DIRECT_PRODUCT_COST',
              uncoveredItems: options.partialCogs
                ? [{ itemId: 'item-1', itemType: 'PRODUK', label: 'Refill', units: 40, reason: 'NO_MATCHING_RECEIVED_PO' }]
                : [],
            },
            opex: {
              amountIdr: options.unverifiedProcurement ? null : 150_000,
              coveredAmountIdr: 150_000,
              status: options.unverifiedProcurement ? 'partial' : 'complete',
              includedEntries: 2,
              excludedProcurementAmountIdr: 400_000,
              excludedProcurementEntries: 1,
              unverifiedProcurementAmountIdr: options.unverifiedProcurement ? 20_000 : 0,
              unverifiedProcurementEntries: options.unverifiedProcurement ? 1 : 0,
              exclusionRule: 'NORMALIZED_CATEGORY_PO_AND_RECEIVED_PO_SOURCE_REF',
            },
          },
    ),
  }) as unknown as DashboardSourcesPort;

describe('DashboardService', () => {
  it('combines complete monthly revenue and costs into operational profit', async () => {
    const service = new DashboardService(pnlSources());
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result).toMatchObject({
      revenueIdr: 1_000_000,
      cogsIdr: 400_000,
      opexIdr: 150_000,
      grossProfitIdr: 600_000,
      netOperatingProfitIdr: 450_000,
      marginPct: 45,
      sources: { order: 'ok', depot: 'ok' },
      reportType: 'OPERATIONAL_MANAGEMENT',
    });
  });

  it('keeps revenue but nulls COGS-derived totals when cost coverage is partial', async () => {
    const service = new DashboardService(pnlSources({ partialCogs: true }));
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result.revenueIdr).toBe(1_000_000);
    expect(result.coveredCogsIdr).toBe(250_000);
    expect(result.cogsIdr).toBeNull();
    expect(result.opexIdr).toBe(150_000);
    expect(result.grossProfitIdr).toBeNull();
    expect(result.netOperatingProfitIdr).toBeNull();
    expect(result.marginPct).toBeNull();
    expect(result.sources).toEqual({ order: 'ok', depot: 'partial' });
  });

  it('keeps real costs but nulls revenue-derived totals when order-service is unavailable', async () => {
    const service = new DashboardService(pnlSources({ orderDown: true }));
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result.revenueIdr).toBeNull();
    expect(result.cogsIdr).toBe(400_000);
    expect(result.opexIdr).toBe(150_000);
    expect(result.grossProfitIdr).toBeNull();
    expect(result.netOperatingProfitIdr).toBeNull();
    expect(result.marginPct).toBeNull();
    expect(result.sources).toEqual({ order: 'unavailable', depot: 'ok' });
  });

  it('marks depot costs partial when a PO-category outflow cannot be verified', async () => {
    const service = new DashboardService(pnlSources({ unverifiedProcurement: true }));
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result.opexIdr).toBeNull();
    expect(result.grossProfitIdr).toBe(600_000);
    expect(result.netOperatingProfitIdr).toBeNull();
    expect(result.marginPct).toBeNull();
    expect(result.sources).toEqual({ order: 'ok', depot: 'partial' });
  });

  it('keeps revenue but nulls every cost/derived value when depot-service is unavailable', async () => {
    const service = new DashboardService(pnlSources({ depotDown: true }));
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result.revenueIdr).toBe(1_000_000);
    expect(result.cogsIdr).toBeNull();
    expect(result.coveredCogsIdr).toBeNull();
    expect(result.opexIdr).toBeNull();
    expect(result.grossProfitIdr).toBeNull();
    expect(result.netOperatingProfitIdr).toBeNull();
    expect(result.sources).toEqual({ order: 'ok', depot: 'unavailable' });
  });

  it('composes all four sections and marks both sources ok', async () => {
    const service = new DashboardService(new InMemoryDashboardSources());
    const result = await service.executive({ from: '2026-06-01', to: '2026-06-30' }, 'Bearer t');

    expect(result.from).toBe('2026-06-01');
    expect(result.to).toBe('2026-06-30');
    expect(result.sales?.buckets).toHaveLength(1);
    expect(result.topCustomers?.items[0].customerId).toBe('cust-1');
    expect(result.topDepots?.items[0].depotId).toBe('depot-1');
    expect(result.deliverySla?.slaRate).toBe(0.92);
    expect(result.sources).toEqual({ order: 'ok', delivery: 'ok' });
  });

  it('marks order unavailable and nulls order sections when order calls fail', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(true));
    const result = await service.executive({}, 'Bearer t');

    expect(result.sales).toBeNull();
    expect(result.topCustomers).toBeNull();
    expect(result.topDepots).toBeNull();
    expect(result.deliverySla).not.toBeNull();
    expect(result.sources).toEqual({ order: 'unavailable', delivery: 'ok' });
    expect(result.from).toBeNull();
    expect(result.to).toBeNull();
  });

  it('scopes revenue + low-stock to owned depots and rolls up totals', async () => {
    const service = new DashboardService(new InMemoryDashboardSources());
    const result = await service.franchise({ from: '2026-06-01', to: '2026-06-30' }, 'Bearer t');

    expect(result.depots).toHaveLength(2);
    // depot-1 is in the top-depots report → real revenue/count + one low-stock line.
    const one = result.depots.find((d) => d.depotId === 'depot-1');
    expect(one).toMatchObject({ code: 'DPT-1', active: true, orderCount: 30, revenue: 900_000, lowStockCount: 1 });
    // depot-2 is not in the top list → reads 0 revenue, still listed.
    const two = result.depots.find((d) => d.depotId === 'depot-2');
    expect(two).toMatchObject({ active: false, orderCount: 0, revenue: 0, lowStockCount: 0 });

    expect(result.totals).toEqual({ depotCount: 2, revenue: 900_000, orderCount: 30, lowStockCount: 1 });
    expect(result.deliverySla?.slaRate).toBe(0.92);
    expect(result.sources).toEqual({ depot: 'ok', order: 'ok', delivery: 'ok', inventory: 'ok' });
  });

  it('rolls up every depot with revenue, SLA and low-stock, null SLA when none in range', async () => {
    const service = new DashboardService(new InMemoryDashboardSources());
    const result = await service.network({ from: '2026-06-01', to: '2026-06-30' }, 'Bearer t');

    expect(result.depots).toHaveLength(2);
    const one = result.depots.find((d) => d.depotId === 'depot-1');
    expect(one).toMatchObject({
      code: 'DPT-1',
      active: true,
      ownershipType: 'PUSAT',
      revenue: 900_000,
      orderCount: 30,
      slaRate: 0.9,
      lowStockCount: 1,
    });
    const two = result.depots.find((d) => d.depotId === 'depot-2');
    // Not in top-depots or sla-by-depot → 0 revenue, null SLA, still listed.
    expect(two).toMatchObject({ active: false, revenue: 0, orderCount: 0, slaRate: null, lowStockCount: 0 });
    expect(result.sources).toEqual({ depot: 'ok', order: 'ok', delivery: 'ok', inventory: 'ok' });
  });

  it('marks order unavailable in the roll-up but still lists depots + SLA', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(true));
    const result = await service.network({}, 'Bearer t');

    expect(result.depots).toHaveLength(2);
    // order-service down → revenue/orders read 0, but depot + delivery + inventory stand.
    expect(result.depots.every((d) => d.revenue === 0 && d.orderCount === 0)).toBe(true);
    expect(result.depots.find((d) => d.depotId === 'depot-1')?.slaRate).toBe(0.9);
    expect(result.sources).toEqual({
      depot: 'ok',
      order: 'unavailable',
      delivery: 'ok',
      inventory: 'ok',
    });
  });

  it('marks depot + order unavailable and empties depots when the owner directory is down', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(true));
    const result = await service.franchise({}, 'Bearer t');

    expect(result.depots).toEqual([]);
    expect(result.totals).toEqual({ depotCount: 0, revenue: 0, orderCount: 0, lowStockCount: 0 });
    // SLA can't be scoped without the owner's depot ids, so it is skipped too.
    expect(result.deliverySla).toBeNull();
    expect(result.sources).toEqual({
      depot: 'unavailable',
      order: 'unavailable',
      delivery: 'unavailable',
      inventory: 'unavailable',
    });
  });
});
