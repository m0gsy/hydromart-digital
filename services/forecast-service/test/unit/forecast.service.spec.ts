import { ForecastService } from '../../src/application/services/forecast.service';
import { FakeForecastRepository } from '../support/fakes';
import { IngestCommand } from '../../src/application/ports/forecast.repository';

const NOW = new Date('2026-07-11T12:00:00Z');
const AT = new Date('2026-07-11T08:00:00Z'); // same UTC day as NOW → lands on the last history day

function makeIngest(overrides: Partial<IngestCommand> = {}): IngestCommand {
  return {
    orderId: 'order-1',
    depotId: null,
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
    service = new ForecastService(repo);
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
});
