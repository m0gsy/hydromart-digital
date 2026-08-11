import { RecommendationService } from '../../src/application/services/recommendation.service';
import { FakeRecommendationRepository } from '../support/fakes';
import { IngestCommand } from '../../src/application/ports/recommendation.repository';

function makeIngest(overrides: Partial<IngestCommand> = {}): IngestCommand {
  return {
    orderId: 'order-1',
    customerId: 'cust-1',
    depotId: null,
    at: new Date('2026-07-11T10:00:00Z'),
    items: [
      { productId: 'a', productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon' },
      { productId: 'b', productName: 'Aqua 600ml', sku: 'AQ06', unit: 'botol' },
      { productId: 'c', productName: 'Le Minerale 19L', sku: 'LM19', unit: 'galon' },
    ],
    ...overrides,
  };
}

describe('RecommendationService', () => {
  let repo: FakeRecommendationRepository;
  let service: RecommendationService;

  beforeEach(() => {
    repo = new FakeRecommendationRepository();
    service = new RecommendationService(repo, { businessTimeZone: 'Asia/Jakarta' } as never);
  });

  it('ingest then reorder returns all purchased products for that customer', async () => {
    await service.ingest(makeIngest());

    const items = await service.reorder('cust-1', 10);

    expect(items.map((i) => i.productId).sort()).toEqual(['a', 'b', 'c']);
    for (const item of items) {
      expect(item.name).toBeTruthy();
      expect(item.sku).toBeTruthy();
      expect(item.unit).toBeTruthy();
      expect(typeof item.score).toBe('number');
    }
  });

  it('related(a) is symmetric and includes b and c (co-buy)', async () => {
    await service.ingest(makeIngest());

    const related = await service.related('a', 10);

    expect(related.map((i) => i.productId).sort()).toEqual(['b', 'c']);
  });

  it('trending(null, days, ...) includes a, b, c for today', async () => {
    await service.ingest(makeIngest());
    // 21:00 WIB on 11 July — the same LOCAL day as the ingest at 17:00 WIB. Written as
    // 23:00Z it was already 06:00 on the 12th in WIB, so "today" no longer contained it (C2).
    const now = new Date('2026-07-11T14:00:00Z');

    const trending = await service.trending(null, 1, 10, now);

    expect(trending.map((i) => i.productId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('ingesting the same orderId twice is idempotent (counts unchanged)', async () => {
    await service.ingest(makeIngest());
    await service.ingest(makeIngest()); // same orderId again

    // Underlying purchase count must not double from the repeated ingest.
    const rows = await repo.reorderRows('cust-1');
    const rowA = rows.find((r) => r.productId === 'a');
    expect(rowA?.purchaseCount).toBe(1);
    expect(repo.ingestedOrderIds.size).toBe(1);

    const items = await service.reorder('cust-1', 10);
    expect(items.map((i) => i.productId).sort()).toEqual(['a', 'b', 'c']);
  });

  // A customer with no history has nothing of their OWN to reorder. The list is filled
  // from network-wide trending (cold start, UAT-M22-08) rather than left blank — what must
  // never happen is the other customer's personal ranking leaking through.
  it('reorder for a customer with no history falls back to trending, not their neighbour’s list', async () => {
    await service.ingest(makeIngest());

    const mine = await service.reorder('cust-1', 10);
    const cold = await service.reorder('someone-else', 10);
    const trending = await service.trending(null, 30, 10);

    expect(cold.map((i) => i.productId)).toEqual(trending.map((i) => i.productId));
    expect(cold.map((i) => i.score)).not.toEqual(mine.map((i) => i.score));
  });

  it('related(unseen productId) returns empty', async () => {
    await service.ingest(makeIngest());

    const items = await service.related('unseen-product', 10);

    expect(items).toEqual([]);
  });

  it('trending with no sales returns empty', async () => {
    const items = await service.trending(null, 30, 10);

    expect(items).toEqual([]);
  });

  it('enriches responses with name/sku/unit from refs and respects limit', async () => {
    await service.ingest(makeIngest());

    const items = await service.reorder('cust-1', 2);

    expect(items).toHaveLength(2);
    const a = items.find((i) => i.productId === 'a');
    expect(a).toMatchObject({ productId: 'a', name: 'Aqua 19L', sku: 'AQ19', unit: 'galon' });
  });

  it('skips ranked ids missing a product ref (defensive enrichment)', async () => {
    await service.ingest(makeIngest());
    // Corrupt the fake's refs to simulate a ranked id with no ref available.
    repo.refs = repo.refs.filter((r) => r.productId !== 'b');

    const items = await service.reorder('cust-1', 10);

    expect(items.map((i) => i.productId).sort()).toEqual(['a', 'c']);
  });

  it('clamps limit above 50 down to at most 50', async () => {
    await service.ingest(makeIngest());

    const items = await service.reorder('cust-1', 999);

    expect(items.length).toBeLessThanOrEqual(50);
  });

  it('clamps limit below 1 up to 1', async () => {
    await service.ingest(makeIngest());

    const items = await service.reorder('cust-1', 0);

    expect(items.length).toBeLessThanOrEqual(1);
  });

  it('clamps days: days=0 behaves like days=1 (today only)', async () => {
    await service.ingest(makeIngest());
    // 21:00 WIB on 11 July — the same LOCAL day as the ingest at 17:00 WIB. Written as
    // 23:00Z it was already 06:00 on the 12th in WIB, so "today" no longer contained it (C2).
    const now = new Date('2026-07-11T14:00:00Z');

    const items = await service.trending(null, 0, 10, now);

    expect(items.map((i) => i.productId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('clamps days above 365 without throwing', async () => {
    await service.ingest(makeIngest());
    // 21:00 WIB on 11 July — the same LOCAL day as the ingest at 17:00 WIB. Written as
    // 23:00Z it was already 06:00 on the 12th in WIB, so "today" no longer contained it (C2).
    const now = new Date('2026-07-11T14:00:00Z');

    await expect(service.trending(null, 10000, 10, now)).resolves.not.toThrow();
  });

  it('trending excludes sales from before the window', async () => {
    await service.ingest(makeIngest({ orderId: 'order-old', at: new Date('2026-01-01T00:00:00Z') }));
    // 21:00 WIB on 11 July — the same LOCAL day as the ingest at 17:00 WIB. Written as
    // 23:00Z it was already 06:00 on the 12th in WIB, so "today" no longer contained it (C2).
    const now = new Date('2026-07-11T14:00:00Z');

    const items = await service.trending(null, 1, 10, now);

    expect(items).toEqual([]);
  });
});

// C2: "trending over the last N days" started at UTC midnight — 07:00 WIB — so for the
// first seven hours of every day the window began mid-morning of the day before and the
// board silently dropped the previous local evening's orders.
describe('RecommendationService.trending window (C2)', () => {
  it('starts the window at LOCAL midnight, not UTC midnight', async () => {
    const repo = new FakeRecommendationRepository();
    const seen: Date[] = [];
    repo.trendingTotals = async (_d: string | null, fromDay: Date) => {
      seen.push(fromDay);
      return [];
    };
    const service = new RecommendationService(repo, { businessTimeZone: 'Asia/Jakarta' } as never);
    // 2 Aug 03:00 WIB. A 1-day window must start at 1 Aug 17:00 UTC = 2 Aug 00:00 WIB.
    await service.trending(null, 1, 10, new Date('2026-08-01T20:00:00.000Z'));
    expect(seen[0].toISOString()).toBe('2026-08-01T17:00:00.000Z');
  });
});
