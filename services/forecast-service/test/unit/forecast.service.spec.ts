import { ForecastService } from '../../src/application/services/forecast.service';
import { FakeForecastRepository } from '../support/fakes';
import { IngestCommand } from '../../src/application/ports/forecast.repository';
import { ForecastConfigService } from '../../src/config/forecast-config.service';

const NOW = new Date('2026-07-11T12:00:00Z');
const AT = new Date('2026-07-11T08:00:00Z'); // same UTC day as NOW → lands on the last history day

const configStub = { churnWindowDays: 45 } as unknown as ForecastConfigService;

function makeIngest(overrides: Partial<IngestCommand> = {}): IngestCommand {
  return {
    orderId: 'order-1',
    customerId: 'cust-1',
    depotId: null,
    total: 85000,
    at: AT,
    items: [{ productId: 'a', productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon', quantity: 3 }],
    ...overrides,
  };
}

describe('ForecastService', () => {
  let repo: FakeForecastRepository;
  let service: ForecastService;

  beforeEach(() => {
    repo = new FakeForecastRepository();
    service = new ForecastService(repo, configStub);
  });

  it('ingest sums QUANTITY (not order count) into daily demand', async () => {
    await service.ingest(makeIngest()); // quantity 3

    const res = await service.demand({ productId: 'a', now: NOW });

    expect(res.history[res.history.length - 1]).toBe(3); // 3 units, not 1 order
    expect(res.history.reduce((s, x) => s + x, 0)).toBe(3);
  });

  it('ingest is idempotent per orderId (double ingest leaves totals unchanged)', async () => {
    await service.ingest(makeIngest());
    await service.ingest(makeIngest()); // same orderId again

    const res = await service.demand({ productId: 'a', now: NOW });

    expect(res.history.reduce((s, x) => s + x, 0)).toBe(3);
    expect(repo.ingestedOrderIds.size).toBe(1);
  });

  it('demand global (depotId undefined) sums across depots', async () => {
    await service.ingest(
      makeIngest({ orderId: 'o1', depotId: 'd1', items: [{ productId: 'a', productName: 'A', sku: 'A', unit: 'u', quantity: 2 }] }),
    );
    await service.ingest(
      makeIngest({ orderId: 'o2', depotId: 'd2', items: [{ productId: 'a', productName: 'A', sku: 'A', unit: 'u', quantity: 5 }] }),
    );

    const res = await service.demand({ productId: 'a', now: NOW }); // depotId omitted → global

    expect(res.history.reduce((s, x) => s + x, 0)).toBe(7);
  });

  it('demand depot-scoped filters to one depot', async () => {
    await service.ingest(
      makeIngest({ orderId: 'o1', depotId: 'd1', items: [{ productId: 'a', productName: 'A', sku: 'A', unit: 'u', quantity: 2 }] }),
    );
    await service.ingest(
      makeIngest({ orderId: 'o2', depotId: 'd2', items: [{ productId: 'a', productName: 'A', sku: 'A', unit: 'u', quantity: 5 }] }),
    );

    const res = await service.demand({ productId: 'a', depotId: 'd1', now: NOW });

    expect(res.history.reduce((s, x) => s + x, 0)).toBe(2);
  });

  it('demand with empty history → all-zero forecast, no throw', async () => {
    const res = await service.demand({ productId: 'unseen', historyDays: 30, horizonDays: 7, now: NOW });

    expect(res.history).toHaveLength(30);
    expect(res.history.every((x) => x === 0)).toBe(true);
    expect(res.predictedDaily).toHaveLength(7);
    expect(res.predictedDaily.every((x) => x === 0)).toBe(true);
    expect(res.predictedTotal).toBe(0);
    expect(res.name).toBeNull();
  });

  it('demand enriches name/sku/unit from ProductRef', async () => {
    await service.ingest(makeIngest());

    const res = await service.demand({ productId: 'a', now: NOW });

    expect(res).toMatchObject({ productId: 'a', name: 'Aqua 19L', sku: 'AQ19', unit: 'galon' });
  });

  it('depotRollup ranks products by predictedTotal desc and respects limit', async () => {
    await service.ingest(
      makeIngest({ orderId: 'o1', depotId: 'd1', items: [{ productId: 'a', productName: 'A', sku: 'A', unit: 'u', quantity: 10 }] }),
    );
    await service.ingest(
      makeIngest({ orderId: 'o2', depotId: 'd1', items: [{ productId: 'b', productName: 'B', sku: 'B', unit: 'u', quantity: 1 }] }),
    );

    const all = await service.depotRollup({ depotId: 'd1', now: NOW });
    expect(all.map((i) => i.productId)).toEqual(['a', 'b']); // higher predictedTotal first
    expect(all[0].predictedTotal).toBeGreaterThanOrEqual(all[1].predictedTotal);

    const limited = await service.depotRollup({ depotId: 'd1', limit: 1, now: NOW });
    expect(limited).toHaveLength(1);
    expect(limited[0].productId).toBe('a');
  });

  it('clamps horizonDays above 90 → predictedDaily length == 90', async () => {
    await service.ingest(makeIngest());

    const res = await service.demand({ productId: 'a', horizonDays: 10000, now: NOW });

    expect(res.predictedDaily).toHaveLength(90);
  });

  it('clamps historyDays below 7 up to 7 (history length == 7)', async () => {
    const res = await service.demand({ productId: 'unseen', historyDays: 1, now: NOW });

    expect(res.history).toHaveLength(7);
  });

  it('salesForecast sums order totals per depot-day and projects, echoing depotId', async () => {
    await service.ingest(makeIngest({ orderId: 'o1', customerId: 'c1', depotId: 'd1', total: 50000 }));
    await service.ingest(makeIngest({ orderId: 'o2', customerId: 'c2', depotId: 'd1', total: 30000 }));

    const res = await service.salesForecast({ depotId: 'd1', now: NOW });

    expect(res.depotId).toBe('d1');
    expect(res.history[res.history.length - 1]).toBe(80000); // both totals, same day + depot
    expect(res.predictedDaily).toHaveLength(7);
  });

  it('salesForecast global (depotId omitted) sums across depots and echoes null', async () => {
    await service.ingest(makeIngest({ orderId: 'o1', customerId: 'c1', depotId: 'd1', total: 50000 }));
    await service.ingest(makeIngest({ orderId: 'o2', customerId: 'c2', depotId: 'd2', total: 30000 }));

    const res = await service.salesForecast({ now: NOW });

    expect(res.depotId).toBeNull();
    expect(res.history[res.history.length - 1]).toBe(80000);
  });

  it('salesForecast depot-scoped filters revenue to one depot', async () => {
    await service.ingest(makeIngest({ orderId: 'o1', customerId: 'c1', depotId: 'd1', total: 50000 }));
    await service.ingest(makeIngest({ orderId: 'o2', customerId: 'c2', depotId: 'd2', total: 30000 }));

    const res = await service.salesForecast({ depotId: 'd1', now: NOW });

    expect(res.history[res.history.length - 1]).toBe(50000);
  });

  it('salesForecast with no revenue → all-zero forecast', async () => {
    const res = await service.salesForecast({ depotId: 'none', now: NOW });

    expect(res.history.every((x) => x === 0)).toBe(true);
    expect(res.predictedTotal).toBe(0);
  });

  it('churnList ranks by recency (most-stale first) and returns ISO lastOrderAt', async () => {
    await service.ingest(makeIngest({ orderId: 'o1', customerId: 'recent', at: new Date('2026-07-10T00:00:00Z') }));
    await service.ingest(makeIngest({ orderId: 'o2', customerId: 'stale', at: new Date('2026-05-01T00:00:00Z') }));

    const { customers } = await service.churnList({ now: NOW });

    expect(customers.map((c) => c.customerId)).toEqual(['stale', 'recent']);
    expect(customers[0].riskScore).toBeGreaterThanOrEqual(customers[1].riskScore);
    expect(customers[0].lastOrderAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('churnList folds Monetary in: a high-spend customer bands lower than a low-spend one at the same recency', async () => {
    const monConfig = { churnWindowDays: 30, churnMonetaryRef: 500_000 } as unknown as ForecastConfigService;
    const monService = new ForecastService(repo, monConfig);
    const lapsed = new Date('2026-06-11T12:00:00Z'); // 30 days before NOW → recency 1
    await monService.ingest(makeIngest({ orderId: 'lo', customerId: 'low', at: lapsed, total: 10_000 }));
    await monService.ingest(makeIngest({ orderId: 'hi', customerId: 'high', at: lapsed, total: 500_000 }));

    const { customers } = await monService.churnList({ now: NOW });
    const low = customers.find((c) => c.customerId === 'low')!;
    const high = customers.find((c) => c.customerId === 'high')!;
    expect(low.riskBand).toBe('HIGH');
    expect(high.riskBand).toBe('MEDIUM');
    expect(high.riskScore).toBeLessThan(low.riskScore);
  });

  it('churnList empty state → no customers, no throw', async () => {
    const { customers } = await service.churnList({ now: NOW });
    expect(customers).toEqual([]);
  });

  it('churnList windowDays override changes banding vs the config default', async () => {
    // One-time buyer (freqWeight 1) 12 days before NOW. Score = recency = daysSince/window,
    // banded in tertiles: window 45 → 12/45 = 0.27 → LOW; window 30 → 12/30 = 0.40 → MEDIUM.
    await service.ingest(makeIngest({ orderId: 'o1', customerId: 'x', at: new Date('2026-06-29T12:00:00Z') }));

    const def = await service.churnList({ now: NOW });
    expect(def.customers[0].riskBand).toBe('LOW');

    const over = await service.churnList({ windowDays: 30, now: NOW });
    expect(over.customers[0].riskBand).toBe('MEDIUM');
  });

  it('churnList limit clamps below 1 up to 1 and slices', async () => {
    const day = 86_400_000;
    for (let i = 0; i < 3; i += 1) {
      await service.ingest(
        makeIngest({ orderId: `o${i}`, customerId: `c${i}`, at: new Date(NOW.getTime() - (i + 1) * day) }),
      );
    }

    const { customers } = await service.churnList({ limit: 0, now: NOW });
    expect(customers).toHaveLength(1);
  });
});
