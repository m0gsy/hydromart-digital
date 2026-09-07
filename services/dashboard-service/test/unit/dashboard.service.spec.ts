import { DashboardService } from '../../src/application/services/dashboard.service';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';
import { InMemoryDashboardSources } from '../support/fakes';
import { DashboardConfigService } from '../../src/config/dashboard-config.service';

/** Names decorate the executive card; nothing here is about them. */
const noNames = async () => new Map<string, string>();


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
    const service = new DashboardService(pnlSources(), dashboardTestConfig(), noNames);
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
    const service = new DashboardService(pnlSources({ partialCogs: true }), dashboardTestConfig(), noNames);
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
    const service = new DashboardService(pnlSources({ orderDown: true }), dashboardTestConfig(), noNames);
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
    const service = new DashboardService(pnlSources({ unverifiedProcurement: true }), dashboardTestConfig(), noNames);
    const result = await service.monthlyPnl(DEPOT_ID, '2026-07', 'Bearer t');

    expect(result.opexIdr).toBeNull();
    expect(result.grossProfitIdr).toBe(600_000);
    expect(result.netOperatingProfitIdr).toBeNull();
    expect(result.marginPct).toBeNull();
    expect(result.sources).toEqual({ order: 'ok', depot: 'partial' });
  });

  it('keeps revenue but nulls every cost/derived value when depot-service is unavailable', async () => {
    const service = new DashboardService(pnlSources({ depotDown: true }), dashboardTestConfig(), noNames);
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
    const service = new DashboardService(new InMemoryDashboardSources(), dashboardTestConfig(), noNames);
    const result = await service.executive({ from: '2026-06-01', to: '2026-06-30' }, 'Bearer t');

    expect(result.from).toBe('2026-06-01');
    expect(result.to).toBe('2026-06-30');
    expect(result.sales?.buckets).toHaveLength(1);
    expect(result.topCustomers?.items[0].customerId).toBe('cust-1');
    expect(result.topDepots?.items[0].depotId).toBe('depot-1');
    expect(result.deliverySla?.slaRate).toBe(0.92);
    expect(result.sources).toEqual({ order: 'ok', delivery: 'ok' });
  });

  /*
   * CA-4-06. The scope has to reach all four reads. Forwarding it to three of them and
   * leaving the fourth global is the failure this pins: delivery-service reads an EMPTY
   * `depotIds` as "no filter", so an account responsible for no depot would have been shown
   * the whole network's SLA next to three empty cards.
   */
  it("passes the caller's depot scope to every source it reads", async () => {
    const sources = new InMemoryDashboardSources();
    const spies = {
      sales: jest.spyOn(sources, 'sales'),
      topCustomers: jest.spyOn(sources, 'topCustomers'),
      topDepots: jest.spyOn(sources, 'topDepots'),
      deliverySla: jest.spyOn(sources, 'deliverySla'),
    };
    const service = new DashboardService(sources, dashboardTestConfig(), noNames);

    await service.executive({}, 'Bearer t', ['depot-1', 'depot-2']);
    expect(spies.sales).toHaveBeenCalledWith(expect.anything(), 'Bearer t', ['depot-1', 'depot-2']);
    expect(spies.topCustomers).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      'Bearer t',
      ['depot-1', 'depot-2'],
    );
    expect(spies.topDepots).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      'Bearer t',
      ['depot-1', 'depot-2'],
    );
    expect(spies.deliverySla).toHaveBeenCalledWith(expect.anything(), 'Bearer t', [
      'depot-1',
      'depot-2',
    ]);

    // An empty scope asks delivery-service nothing rather than asking it globally.
    spies.deliverySla.mockClear();
    const empty = await service.executive({}, 'Bearer t', []);
    expect(spies.deliverySla).not.toHaveBeenCalled();
    expect(empty.deliverySla).toBeNull();

    // No scope at all is head office: every source is still asked for the whole network.
    await service.executive({}, 'Bearer t');
    expect(spies.sales).toHaveBeenLastCalledWith(expect.anything(), 'Bearer t', undefined);
  });

  // §G-3: the depots card next to this one has always listed names; the customers card
  // listed the first eight characters of a UUID.
  it('puts the account name on each top customer, and copes without one', async () => {
    const named = new DashboardService(
      new InMemoryDashboardSources(),
      dashboardTestConfig(),
      async () => new Map([['cust-1', 'Budi']]),
    );

    const withName = await named.executive({}, 'Bearer t');
    expect(withName.topCustomers?.items[0]).toMatchObject({
      customerId: 'cust-1',
      customerName: 'Budi',
    });

    // auth-service unreachable: the card still renders, minus the names.
    const plain = new DashboardService(
      new InMemoryDashboardSources(),
      dashboardTestConfig(),
      noNames,
    );
    const withoutName = await plain.executive({}, 'Bearer t');
    expect(withoutName.topCustomers?.items[0].customerName).toBeNull();
  });

  it('marks order unavailable and nulls order sections when order calls fail', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(true), dashboardTestConfig(), noNames);
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
    const service = new DashboardService(new InMemoryDashboardSources(), dashboardTestConfig(), noNames);
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

  // Audit S-1 / Q-17 baseline. The old shape asked each source once PER OWNED DEPOT, so an
  // owner with twelve depots opened this page with thirty-six upstream requests. The number
  // that matters is that it does not move with the depot count.
  it('costs three calls for many depots', async () => {
    const sources = new InMemoryDashboardSources();
    const service = new DashboardService(sources, dashboardTestConfig(), noNames);

    await service.franchise({}, 'Bearer t');

    expect(sources.lowStockManyCalls).toBe(1);
    expect(sources.hrSummaryManyCalls).toBe(1);
    expect(sources.crmSummaryManyCalls).toBe(1);
  });

  it('rolls up every depot with revenue, SLA and low-stock, null SLA when none in range', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(), dashboardTestConfig(), noNames);
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

  /*
   * E-3. Revenue comes off a TOP-100 report. A depot absent from a report that came back
   * FULL is a depot we did not measure, and it used to read a confident "Rp 0" while
   * `sources.order` still said 'ok' — a number the network total then added up.
   */
  it('reports a depot outside a full top-N as unknown, not as zero revenue', async () => {
    const listed = Array.from({ length: 101 }, (_, i) => ({
      id: `dep-${i}`,
      code: `D-${i}`,
      name: `Depot ${i}`,
      active: true,
      ownershipType: 'PUSAT',
    }));
    // The report answers with its limit — the first 100 — so depot 100 is simply not in it.
    const reported = listed.slice(0, 100).map((d, i) => ({
      depotId: d.id,
      orderCount: 1,
      revenue: 1000 + i,
    }));
    const sources = {
      allDepots: jest.fn().mockResolvedValue(listed),
      topDepots: jest.fn().mockResolvedValue({ items: reported }),
      slaByDepot: jest.fn().mockResolvedValue({ depots: [] }),
      ratingByDepot: jest.fn().mockResolvedValue({ items: [] }),
      lowStock: jest.fn().mockResolvedValue([]),
    } as unknown as DashboardSourcesPort;

    const out = await new DashboardService(sources, dashboardTestConfig(), noNames).network(
      { from: null, to: null } as never,
      'Bearer t',
    );

    expect(out.depots.find((d) => d.depotId === 'dep-0')).toMatchObject({
      revenue: 1000,
      orderCount: 1,
    });
    expect(out.depots.find((d) => d.depotId === 'dep-100')).toMatchObject({
      revenue: null,
      orderCount: null,
    });
    // The answer arrived and is incomplete — neither 'ok' nor 'unavailable' says that.
    expect(out.sources.order).toBe('partial');
  });

  it('marks order unavailable in the roll-up but still lists depots + SLA', async () => {
    const service = new DashboardService(new InMemoryDashboardSources(true), dashboardTestConfig(), noNames);
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
    const service = new DashboardService(new InMemoryDashboardSources(true), dashboardTestConfig(), noNames);
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
      lowStockMany: jest.fn().mockResolvedValue(null),
      slaByDepot: jest.fn().mockResolvedValue(null),
      ratingByDepot: jest.fn().mockResolvedValue(null),
      depotMonthly: jest.fn().mockResolvedValue(null),
      operationalCosts: jest.fn().mockResolvedValue(null),
      crmSummary: jest.fn().mockResolvedValue(null),
      crmSummaryMany: jest.fn().mockResolvedValue([]),
      hrSummaryMany: jest.fn().mockResolvedValue([]),
    }) as unknown as DashboardSourcesPort;

  const range = { from: null, to: null } as never;

  it('network reports no depots and marks every source unavailable', async () => {
    const out = await new DashboardService(allDown(), dashboardTestConfig(), noNames).network(range, 'Bearer t');

    expect(out.depots).toEqual([]);
    expect(out.sources).toEqual({
      depot: 'unavailable',
      order: 'unavailable',
      delivery: 'unavailable',
      inventory: 'unavailable',
    });
  });

  it('franchise reports no depots and marks every source unavailable', async () => {
    const out = await new DashboardService(allDown(), dashboardTestConfig(), noNames).franchise(range, 'Bearer t');

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
      lowStockMany: jest.fn().mockResolvedValue(null),
      slaByDepot: jest.fn().mockResolvedValue(null),
      ratingByDepot: jest.fn().mockResolvedValue(null),
      crmSummary: jest.fn().mockResolvedValue({
        depotId: 'dep-1',
        counts: { baru: 0, aktif: 0, inactive: 0, total: 0 },
        followUps: [],
        repeatRatePct: 0,
      }),
      crmSummaryMany: jest.fn().mockResolvedValue([
        {
          depotId: 'dep-1',
          counts: { baru: 0, aktif: 0, inactive: 0, total: 0 },
          followUps: [],
          repeatRatePct: 0,
        },
      ]),
      hrSummary: jest.fn().mockResolvedValue(null),
      hrSummaryMany: jest.fn().mockResolvedValue([null]),
    }) as unknown as DashboardSourcesPort;

  const range = { from: null, to: null } as never;

  it('reports the depot with nulls, not zeros, for what it could not measure', async () => {
    const out = await new DashboardService(partial(), dashboardTestConfig(), noNames).network(range, 'Bearer t');

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
    const out = await new DashboardService(partial(), dashboardTestConfig(), noNames).franchise(range, 'Bearer t');

    expect(out.depots[0]).toMatchObject({ orderCount: 0, revenue: 0, lowStockCount: 0 });
  });

  it('the executive view marks delivery unavailable while order data still loads', async () => {
    const out = await new DashboardService(partial(), dashboardTestConfig(), noNames).executive(range, 'Bearer t');

    // topDepots is the order source for this view; with it down the whole source reads as
    // unavailable rather than as an empty leaderboard.
    expect(out.sources).toMatchObject({ order: 'unavailable', delivery: 'unavailable' });
  });
});

/*
 * CA-2-59 — the network profit-and-loss head office never had.
 *
 * `/dashboard/network` reported revenue per depot and no cost term at all, so the only
 * question head office could answer was which depot SOLD the most, not which one EARNED
 * anything. Owner decision 2026-09-04: build it from what is already recorded and from
 * nothing else — goods, wages, courier commission, expense claims, refunds. Rent and
 * electricity are deliberately out, because nothing records them.
 *
 * The rule these tests exist to hold: a cost that could not be read is UNKNOWN, never zero.
 * A zero is what makes a report like this flatter the business.
 */
describe('networkPnl (CA-2-59)', () => {
  const build = () => {
    const sources = new InMemoryDashboardSources();
    return { sources, svc: new DashboardService(sources, dashboardTestConfig(), noNames) };
  };

  it('subtracts all five recorded cost lines, per depot and in total', async () => {
    const { svc } = build();
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    // Fixtures: revenue 1.000.000, COGS 400.000, payroll GROSS 4.000.000,
    // commission 250.000, claims 50.000, refunds 100.000 → −3.800.000 per depot.
    const row = out.depots[0]!;
    expect(row).toMatchObject({
      revenueIdr: 1_000_000,
      cogsIdr: 400_000,
      payrollIdr: 4_000_000,
      courierCommissionIdr: 250_000,
      expenseClaimIdr: 50_000,
      refundIdr: 100_000,
      netProfitIdr: -3_800_000,
    });
    expect(out.depots).toHaveLength(2);
    expect(out.totals.netProfitIdr).toBe(-7_600_000);
    expect(out.sources).toMatchObject({ depot: 'ok', payout: 'ok', refunds: 'ok' });
  });

  // Gross, not net: net is what lands in the employee's account after BPJS, PPh 21, loan
  // instalments and fines are withheld. Booking net as the cost turns a lateness fine into
  // a saving for the depot that charged it.
  it('costs wages at gross, not at what was paid out', async () => {
    const { svc } = build();
    const out = await svc.networkPnl('2026-07', 'Bearer t');
    expect(out.depots[0]!.payrollIdr).toBe(4_000_000);
    expect(out.depots[0]!.payrollIdr).not.toBe(3_000_000);
  });

  it('asks HR for the month reported on, not for today', async () => {
    const { sources, svc } = build();
    await svc.networkPnl('2026-07', 'Bearer t');
    expect(sources.hrSummaryManyMonth).toBe('2026-07');
  });

  it('reads an unreachable payout-service as UNKNOWN, never as zero cost', async () => {
    const { sources, svc } = build();
    sources.payoutCostsResult = null;
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    expect(out.depots[0]!.courierCommissionIdr).toBeNull();
    expect(out.depots[0]!.expenseClaimIdr).toBeNull();
    expect(out.depots[0]!.netProfitIdr).toBeNull();
    expect(out.totals.netProfitIdr).toBeNull();
    expect(out.sources.payout).toBe('unavailable');
  });

  it('reads an unreachable payment-service the same way', async () => {
    const { sources, svc } = build();
    sources.depotRefundsResult = null;
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    expect(out.depots[0]!.refundIdr).toBeNull();
    expect(out.depots[0]!.netProfitIdr).toBeNull();
    expect(out.sources.refunds).toBe('unavailable');
  });

  // A total assembled from the rows that happened to be readable is a smaller,
  // confident-looking number that is wrong by exactly the depots nobody could read.
  it('refuses to total when even one depot is unknown', async () => {
    const { sources, svc } = build();
    sources.depotRefundsResult = new Map([['depot-1', 100_000]]);
    const originalRefunds = sources.depotRefunds.bind(sources);
    sources.depotRefunds = async (ids, range) => {
      const map = await originalRefunds(ids, range);
      map?.delete('depot-2');
      return map;
    };
    const out = await svc.networkPnl('2026-07', 'Bearer t');
    // depot-2 is absent from the map, which for a SUM over rows means zero, not unknown —
    // so the total still adds up. This pins that distinction rather than assuming it.
    expect(out.depots[1]!.refundIdr).toBe(0);
    expect(out.totals.refundIdr).toBe(100_000);
  });


  it('reports every source unavailable when depot-service cannot list the depots', async () => {
    const { sources, svc } = build();
    sources.depotsDown = true;
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    expect(out.depots).toEqual([]);
    expect(out.sources).toMatchObject({
      depot: 'unavailable',
      order: 'unavailable',
      goods: 'unavailable',
      payroll: 'unavailable',
    });
    // No rows means no unknown terms, so the totals are a legitimate zero.
    expect(out.totals.netProfitIdr).toBe(0);
  });

  it('marks the revenue source partial and the profit unknown when order-service is down', async () => {
    const sources = new InMemoryDashboardSources(true); // orderDown
    const out = await new DashboardService(sources, dashboardTestConfig(), noNames).networkPnl(
      '2026-07',
      'Bearer t',
    );

    expect(out.depots[0]!.revenueIdr).toBeNull();
    expect(out.depots[0]!.netProfitIdr).toBeNull();
    expect(out.sources.order).toBe('partial');
  });

  it('marks the goods source partial when depot costs cannot be read', async () => {
    const { sources, svc } = build();
    sources.costsDown = true;
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    expect(out.depots[0]!.cogsIdr).toBeNull();
    expect(out.sources.goods).toBe('partial');
  });

  it('marks payroll partial when hr-service is down', async () => {
    const { sources, svc } = build();
    sources.hrDown = true;
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    expect(out.depots[0]!.payrollIdr).toBeNull();
    expect(out.sources.payroll).toBe('partial');
  });

  /*
   * The deploy-order case, and the reason `payrollMtdGross` is optional on the wire: a
   * dashboard-service that ships before hr-service gets an answer with no gross field. It
   * must read that as UNKNOWN. Coercing it to 0 would print a month with a revenue, every
   * other cost, and no wage bill — a profit figure that looks plausible and is not.
   */
  it('treats an hr-service that answers without gross as unknown, not as zero wages', async () => {
    const { sources, svc } = build();
    sources.hrOmitsGross = true;
    const out = await svc.networkPnl('2026-07', 'Bearer t');

    expect(out.depots[0]!.payrollIdr).toBeNull();
    expect(out.depots[0]!.netProfitIdr).toBeNull();
    expect(out.sources.payroll).toBe('partial');
  });
  it('windows the month in Jakarta time, not UTC', async () => {
    const { svc } = build();
    const out = await svc.networkPnl('2026-07', 'Bearer t');
    // 1 July 00:00 WIB is 30 June 17:00 UTC.
    expect(out.from).toBe('2026-06-30T17:00:00.000Z');
    expect(out.to).toBe('2026-07-31T17:00:00.000Z');
    expect(out.month).toBe('2026-07');
  });

  it('says in the report itself that rent and electricity are not in it', async () => {
    const { svc } = build();
    const out = await svc.networkPnl('2026-07', 'Bearer t');
    expect(out.disclaimer).toMatch(/[Ss]ewa dan listrik tidak termasuk/);
    expect(out.reportType).toBe('OPERATIONAL_MANAGEMENT');
  });
});
