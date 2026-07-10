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
});
