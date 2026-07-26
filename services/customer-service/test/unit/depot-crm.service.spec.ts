import { DepotCrmService } from '../../src/application/services/depot-crm.service';
import { DepotCrmRepository, DepotCustomerRow } from '../../src/application/ports/depot-crm.repository';
import { DepotCustomerOrderStats, OrderCrmPort } from '../../src/application/ports/order-crm.port';

// Minimal fake: only findIdsByDepot is exercised here; the other deps are unused by this method.
class FakeDepotCrmRepository implements DepotCrmRepository {
  byDepot = new Map<string, string[]>();
  async listDepotCustomers(): Promise<DepotCustomerRow[]> {
    return [];
  }
  async findIdsByDepot(depotId: string): Promise<string[]> {
    return this.byDepot.get(depotId) ?? [];
  }
}

describe('DepotCrmService.listCustomerIdsByDepot', () => {
  it('returns only the ids whose favourite depot matches', async () => {
    const repo = new FakeDepotCrmRepository();
    repo.byDepot.set('depot-a', ['c1', 'c2']);
    repo.byDepot.set('depot-b', ['c3']);
    const service = new DepotCrmService(repo, {} as never, {} as never, {} as never, {} as never);

    expect(await service.listCustomerIdsByDepot('depot-a')).toEqual(['c1', 'c2']);
    expect(await service.listCustomerIdsByDepot('depot-b')).toEqual(['c3']);
    expect(await service.listCustomerIdsByDepot('depot-unknown')).toEqual([]);
  });
});

describe('DepotCrmService.getCrmDashboard', () => {
  const config = { crmThresholds: { newDays: 30, activeDays: 30, followUpDays: 60 } } as never;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  function serviceWithStats(stats: DepotCustomerOrderStats[]): DepotCrmService {
    const orderCrm: OrderCrmPort = { depotCustomerStats: async () => stats };
    return new DepotCrmService(new FakeDepotCrmRepository(), {} as never, {} as never, orderCrm, config);
  }

  it('counts segments, repeat rate, and overdue follow-ups (most-overdue first)', async () => {
    const service = serviceWithStats([
      { customerId: 'baru', name: 'B', phone: '1', orderCount: 1, totalSpent: 50_000, firstOrderAt: daysAgo(5), lastOrderAt: daysAgo(5) },
      { customerId: 'aktif', name: 'A', phone: '2', orderCount: 4, totalSpent: 200_000, firstOrderAt: daysAgo(200), lastOrderAt: daysAgo(10) },
      { customerId: 'lapse', name: 'L', phone: '3', orderCount: 2, totalSpent: 90_000, firstOrderAt: daysAgo(300), lastOrderAt: daysAgo(70) },
      { customerId: 'gone', name: 'G', phone: '4', orderCount: 1, totalSpent: 30_000, firstOrderAt: daysAgo(400), lastOrderAt: daysAgo(120) },
    ]);

    const d = await service.getCrmDashboard('depot-a');

    expect(d.counts).toEqual({ baru: 1, aktif: 1, inactive: 2, total: 4 });
    expect(d.repeatRatePct).toBe(50); // aktif(4) + lapse(2) have >1 order
    expect(d.followUps.map((f) => f.customerId)).toEqual(['gone', 'lapse']); // 120d before 70d
  });

  it('empty stats → zeroed dashboard', async () => {
    const d = await serviceWithStats([]).getCrmDashboard('depot-a');
    expect(d).toEqual({ counts: { baru: 0, aktif: 0, inactive: 0, total: 0 }, repeatRatePct: 0, followUps: [] });
  });
});
