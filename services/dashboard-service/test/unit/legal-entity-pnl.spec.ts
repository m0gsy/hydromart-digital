import { DashboardService, NetworkPnl, NetworkPnlDepotRow } from '../../src/application/services/dashboard.service';
import { AiReadSourcesPort, DepotEntitySpan } from '../../src/application/ports/ai-read-sources.port';
import { LegalEntityPnlService, MOVED_MID_MONTH } from '../../src/application/services/legal-entity-pnl.service';

const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';

const row = (id: string, over: Partial<NetworkPnlDepotRow> = {}): NetworkPnlDepotRow => ({
  depotId: id, code: id.toUpperCase(), name: `Depot ${id}`, active: true,
  revenueIdr: 1_000, cogsIdr: 100, payrollIdr: 200, courierCommissionIdr: 10, expenseClaimIdr: 5, refundIdr: 5,
  fixedCostIdr: null, fixedCostStatus: 'not_entered', netProfitIdr: 680, ...over,
});

const build = (depots: NetworkPnlDepotRow[], spans: DepotEntitySpan[] | null, names: Record<string, string | null> = {}) => {
  const pnl = {
    payVisible: true, month: '2026-11', from: 'a', to: 'b', reportType: 'OPERATIONAL_MANAGEMENT', disclaimer: 'x',
    depots, totals: DashboardService.pnlTotals(depots),
    sources: { depot: 'ok', order: 'ok', goods: 'ok', payroll: 'ok', payout: 'ok', refunds: 'ok', fixedCosts: 'ok' },
  } as NetworkPnl;
  const dashboard = { networkPnl: jest.fn().mockResolvedValue(pnl) } as unknown as DashboardService;
  const sources = {
    entityTimeline: jest.fn().mockResolvedValue(spans),
    entityName: jest.fn(async (id: string) => (id in names ? names[id] : `Name ${id.slice(-2)}`)),
  } as unknown as AiReadSourcesPort;
  return { svc: new LegalEntityPnlService(dashboard, sources), dashboard, sources };
};

describe('LegalEntityPnlService (HD-16 PR-B)', () => {
  it('groups depots held the whole month, sums with the network formula, and leaves movers out by name', async () => {
    const { svc, dashboard, sources } = build(
      [row('a'), row('b', { fixedCostIdr: 50, fixedCostStatus: 'entered', netProfitIdr: 630 }), row('c'), row('m')],
      [
        { depotId: 'a', legalEntityId: E1, from: '2026-11-01' },
        { depotId: 'b', legalEntityId: E1, from: '2026-11-01' },
        { depotId: 'c', legalEntityId: E2, from: '2026-11-01' },
        { depotId: 'm', legalEntityId: E1, from: '2026-11-01' },
        { depotId: 'm', legalEntityId: E2, from: '2026-11-15' },
      ],
    );
    const out = await svc.legalEntityPnl('2026-11', 'Bearer t', ['a', 'b', 'c', 'm'], true);
    expect(dashboard.networkPnl).toHaveBeenCalledWith('2026-11', 'Bearer t', ['a', 'b', 'c', 'm'], true);
    expect(sources.entityTimeline).toHaveBeenCalledWith(['a', 'b', 'c', 'm'], '2026-11-01', '2026-11-30');
    expect(out.entities.map((e) => [e.legalEntityId, e.depots.map((d) => d.depotId)])).toEqual([[E1, ['a', 'b']], [E2, ['c']]]);
    expect(out.entities[0]!.totals).toMatchObject({ revenueIdr: 2_000, fixedCostIdr: 50, fixedCostStatus: 'partial', netProfitIdr: 1_310 });
    expect(out.entities[1]!.totals).toMatchObject({ revenueIdr: 1_000, fixedCostIdr: null, fixedCostStatus: 'not_entered' });
    expect(out.excluded).toEqual([{ depotId: 'm', code: 'M', name: 'Depot m', reason: MOVED_MID_MONTH }]);
    // The cards and the left-out depot reconcile with the network total.
    expect(out.excludedTotals).toMatchObject({ revenueIdr: 1_000, netProfitIdr: 680 });
    const sumRevenue = out.entities.reduce((n, e) => n + (e.totals.revenueIdr ?? 0), 0) + out.excludedTotals!.revenueIdr!;
    expect(sumRevenue).toBe(4_000);
    expect(out.sources.legalEntities).toBe('ok');
    expect(out.to).toBe('2026-11-30');
  });

  it('puts depots without a recorded entity in their own group, and shows an unreadable name as its id', async () => {
    const { svc } = build(
      [row('a'), row('z')],
      [{ depotId: 'a', legalEntityId: null, from: '2026-02-01' }, { depotId: 'z', legalEntityId: E1, from: '2026-02-01' }],
      { [E1]: null },
    );
    const out = await svc.legalEntityPnl('2026-02', 't', undefined, true);
    expect(out.to).toBe('2026-02-28');
    expect(out.entities.map((e) => e.name).sort()).toEqual(['Badan hukum (nama tidak terbaca)', 'Belum ada badan hukum'].sort());
    expect(out.entities.find((e) => e.legalEntityId === E1)).toMatchObject({ nameUnread: true });
    expect(out.entities.find((e) => e.legalEntityId === null)).toMatchObject({ nameUnread: false });
    expect(out.excludedTotals).toBeNull();
    expect(out.entities.find((e) => e.legalEntityId === null)!.depots).toHaveLength(1);
  });

  describe('month boundaries and repeats (spans as depot-service entitySpans returns them)', () => {
    const run = (spans: DepotEntitySpan[]) => build([row('a')], spans).svc.legalEntityPnl('2026-11', 't', undefined, true);

    it('a point on the 1st is one span: the depot counts for that entity', async () => {
      const out = await run([{ depotId: 'a', legalEntityId: E1, from: '2026-11-01' }]);
      expect(out.entities.map((e) => e.legalEntityId)).toEqual([E1]);
      expect(out.excluded).toEqual([]);
    });

    it('a point on the last day is a move: left out', async () => {
      const out = await run([
        { depotId: 'a', legalEntityId: E1, from: '2026-11-01' },
        { depotId: 'a', legalEntityId: E2, from: '2026-11-30' },
      ]);
      expect(out.entities).toEqual([]);
      expect(out.excluded.map((d) => d.depotId)).toEqual(['a']);
    });

    it('a point on the 1st of next month is not in the span list, so the depot stays whole', async () => {
      const out = await run([{ depotId: 'a', legalEntityId: E1, from: '2026-11-01' }]);
      expect(out.excluded).toEqual([]);
      expect(out.entities[0]!.depots.map((d) => d.depotId)).toEqual(['a']);
    });

    it('the same entity re-asserted mid-month is no move', async () => {
      const out = await run([
        { depotId: 'a', legalEntityId: E1, from: '2026-11-01' },
        { depotId: 'a', legalEntityId: E1, from: '2026-11-15' },
      ]);
      expect(out.excluded).toEqual([]);
      expect(out.entities.map((e) => e.legalEntityId)).toEqual([E1]);
    });

    it('none, then an entity mid-month, is a move', async () => {
      const out = await run([
        { depotId: 'a', legalEntityId: null, from: '2026-11-01' },
        { depotId: 'a', legalEntityId: E1, from: '2026-11-15' },
      ]);
      expect(out.entities).toEqual([]);
      expect(out.excluded).toHaveLength(1);
    });
  });

  it('a scoped caller sums only the depots the network P&L returned for them', async () => {
    const { svc, dashboard, sources } = build(
      [row('a')],
      [{ depotId: 'a', legalEntityId: E1, from: '2026-11-01' }],
    );
    const out = await svc.legalEntityPnl('2026-11', 't', ['a'], true);
    expect(dashboard.networkPnl).toHaveBeenCalledWith('2026-11', 't', ['a'], true);
    expect(sources.entityTimeline).toHaveBeenCalledWith(['a'], '2026-11-01', '2026-11-30');
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.totals.revenueIdr).toBe(1_000);
  });

  it('treats a depot with no span at all as unassigned', async () => {
    const { svc } = build([row('a')], []);
    const out = await svc.legalEntityPnl('2026-11', 't', undefined, true);
    expect(out.entities[0]).toMatchObject({ legalEntityId: null });
  });

  it('answers with no entities and says so when depot-service cannot be read', async () => {
    const { svc } = build([row('a')], null);
    const out = await svc.legalEntityPnl('2026-11', 't', undefined, true);
    expect(out).toMatchObject({ entities: [], excluded: [] });
    expect(out.sources.legalEntities).toBe('unavailable');
  });

  it('does not ask depot-service anything for an empty network', async () => {
    const { svc, sources } = build([], []);
    const out = await svc.legalEntityPnl('2026-11', 't', undefined, true);
    expect(out.entities).toEqual([]);
    expect(sources.entityTimeline).not.toHaveBeenCalled();
  });
});
