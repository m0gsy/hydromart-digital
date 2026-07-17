import { DashboardService } from '../../src/application/services/dashboard.service';
import { InMemoryDashboardSources } from '../support/fakes';

describe('DashboardService', () => {
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
