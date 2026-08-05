import { DashboardService } from '../../src/application/services/dashboard.service';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';
import { InMemoryDashboardSources } from '../support/fakes';
import { DashboardConfigService } from '../../src/config/dashboard-config.service';

/** Only `businessTimeZone` is read; WIB pinned so a UTC month-window regression (H-16)
 * fails here rather than in a depot's P&L. */
const dashboardTestConfig = (timeZone = 'Asia/Jakarta'): DashboardConfigService =>
  ({ businessTimeZone: timeZone }) as DashboardConfigService;


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
    const service = new DashboardService(pnlSources(), dashboardTestConfig());
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
    const service = new DashboardService(pnlSources({ partialCogs: true }), dashboardTestConfig());
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
    const service = new DashboardService(pnlSources({ orderDown: true }), dashboardTestConfig());
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
    const service = new DashboardService(pnlSources({ unverifiedProcurement: true }), dashboardTestConfig());
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result.opexIdr).toBeNull();
    expect(result.grossProfitIdr).toBe(600_000);
    expect(result.netOperatingProfitIdr).toBeNull();
    expect(result.marginPct).toBeNull();
    expect(result.sources).toEqual({ order: 'ok', depot: 'partial' });
  });

  it('keeps revenue but nulls every cost/derived value when depot-service is unavailable', async () => {
    const service = new DashboardService(pnlSources({ depotDown: true }), dashboardTestConfig());
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
    const service = new DashboardService(new InMemoryDashboardSources(), dashboardTestConfig());
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
    const service = new DashboardService(new InMemoryDashboardSources(true), dashboardTestConfig());
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
    const service = new DashboardService(new InMemoryDashboardSources(), dashboardTestConfig());
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
    expect(result.sources).toEqual({ depot: 'ok', order: 'ok', delivery: 'ok', inventory: 'ok', hr: 'ok', crm: 'ok' });
    // HR + CRM owner roll-up across the 2 owned depots (Fase 5).
    expect(result.hr).toEqual({ lateToday: 2, absentToday: 4, presentToday: 10, payrollMtdNet: 6_000_000, activeHeadcount: 16 });
    expect(result.crm).toEqual({ baru: 2, aktif: 6, inactive: 4, total: 12, followUpCount: 2, repeatRatePct: 50 });
  });

  it('rolls up every depot with revenue, SLA and low-stock, null SLA when none in range', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(), dashboardTestConfig());
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
    const service = new DashboardService(new InMemoryDashboardSources(true), dashboardTestConfig());
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
    const service = new DashboardService(new InMemoryDashboardSources(true), dashboardTestConfig());
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
      hr: 'unavailable',
      crm: 'unavailable',
    });
    // No owned depots → nothing to roll up.
    expect(result.hr).toBeNull();
    expect(result.crm).toBeNull();
  });
});

// Every upstream is optional: the console must still render, marking each source as
// unavailable rather than inventing a zero that looks like a real measurement.
describe('DashboardService with every upstream down', () => {
  const allDown = () =>
    ({
      sales: jest.fn().mockResolvedValue(null),
      topCustomers: jest.fn().mockResolvedValue(null),
      topDepots: jest.fn().mockResolvedValue(null),
      deliverySla: jest.fn().mockResolvedValue(null),
      myDepots: jest.fn().mockResolvedValue(null),
      allDepots: jest.fn().mockResolvedValue(null),
      lowStock: jest.fn().mockResolvedValue(null),
      slaByDepot: jest.fn().mockResolvedValue(null),
      ratingByDepot: jest.fn().mockResolvedValue(null),
      depotMonthly: jest.fn().mockResolvedValue(null),
      operationalCosts: jest.fn().mockResolvedValue(null),
      crmSummary: jest.fn().mockResolvedValue(null),
    }) as unknown as DashboardSourcesPort;

  const range = { from: null, to: null } as never;

  it('network reports no depots and marks every source unavailable', async () => {
    const out = await new DashboardService(allDown(), dashboardTestConfig()).network(range, 'Bearer t');

    expect(out.depots).toEqual([]);
    expect(out.sources).toEqual({
      depot: 'unavailable',
      order: 'unavailable',
      delivery: 'unavailable',
      inventory: 'unavailable',
    });
  });

  it('franchise reports no depots and marks every source unavailable', async () => {
    const out = await new DashboardService(allDown(), dashboardTestConfig()).franchise(range, 'Bearer t');

    expect(out.depots).toEqual([]);
    expect(Object.values(out.sources)).toContain('unavailable');
  });
});

describe('DashboardService when the depots list survives but nothing else does', () => {
  const depots = [
    { id: 'dep-1', code: 'JKT-01', name: 'Depot Cikini', active: true, ownershipType: 'MILIK_SENDIRI' },
  ];
  const partial = () =>
    ({
      sales: jest.fn().mockResolvedValue({ totalRevenue: 0, orderCount: 0 }),
      topCustomers: jest.fn().mockResolvedValue({ items: [] }),
      topDepots: jest.fn().mockResolvedValue(null),
      deliverySla: jest.fn().mockResolvedValue(null),
      myDepots: jest.fn().mockResolvedValue(depots),
      allDepots: jest.fn().mockResolvedValue(depots),
      lowStock: jest.fn().mockResolvedValue(null),
      slaByDepot: jest.fn().mockResolvedValue(null),
      ratingByDepot: jest.fn().mockResolvedValue(null),
      crmSummary: jest.fn().mockResolvedValue({
        depotId: 'dep-1',
        counts: { baru: 0, aktif: 0, inactive: 0, total: 0 },
        followUps: [],
        repeatRatePct: 0,
      }),
      hrSummary: jest.fn().mockResolvedValue(null),
    }) as unknown as DashboardSourcesPort;

  const range = { from: null, to: null } as never;

  it('reports the depot with nulls, not zeros, for what it could not measure', async () => {
    const out = await new DashboardService(partial(), dashboardTestConfig()).network(range, 'Bearer t');

    expect(out.depots[0]).toMatchObject({
      depotId: 'dep-1',
      orderCount: 0,
      slaRate: null,
      avgMinutes: null,
      rating: null,
      lowStockCount: 0,
    });
    expect(out.sources.inventory).toBe('unavailable');
  });

  it('the franchise view does the same, and a depot with no customers is 0% repeat', async () => {
    const out = await new DashboardService(partial(), dashboardTestConfig()).franchise(range, 'Bearer t');

    expect(out.depots[0]).toMatchObject({ orderCount: 0, revenue: 0, lowStockCount: 0 });
  });

  it('the executive view marks delivery unavailable while order data still loads', async () => {
    const out = await new DashboardService(partial(), dashboardTestConfig()).executive(range, 'Bearer t');

    // topDepots is the order source for this view; with it down the whole source reads as
    // unavailable rather than as an empty leaderboard.
    expect(out.sources).toMatchObject({ order: 'unavailable', delivery: 'unavailable' });
  });
});
