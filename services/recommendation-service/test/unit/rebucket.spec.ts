import { RebuildService } from '../../src/application/services/rebuild.service';
import { RecommendationService } from '../../src/application/services/recommendation.service';
import { IngestCommand } from '../../src/application/ports/recommendation.repository';
import { FakeOrderFeed, FakeRecommendationRepository } from '../support/fakes';

/*
 * REC-01, the old data. Daily-sales rows written before the business-zone fix are keyed by the UTC
 * day, so an order placed 00:00-07:00 WIB sits in the day before. The table keeps no per-order
 * timestamp, so it cannot be corrected in place; the order feed can rebuild it. This replaces the
 * whole table with the feed's orders bucketed by the business-zone day, in one swap.
 */
describe('RebuildService.rebucketDailySales (REC-01)', () => {
  const item = (productId: string, quantity?: number) => ({
    productId,
    productName: productId,
    sku: productId,
    unit: 'galon',
    quantity,
  });
  const order = (orderId: string, at: string, items: ReturnType<typeof item>[], depotId: string | null = 'dep-1'): IngestCommand => ({
    orderId,
    customerId: 'c1',
    depotId,
    at: new Date(at),
    items,
  });

  function build(orders: IngestCommand[]) {
    const repo = new FakeRecommendationRepository();
    const service = new RecommendationService(repo, { businessTimeZone: 'Asia/Jakarta' } as never);
    const rebuild = new RebuildService(new FakeOrderFeed(orders), service, repo);
    return { repo, rebuild };
  }
  const days = (repo: FakeRecommendationRepository) =>
    repo.dailySales
      .map((r) => `${r.productId}|${r.depotId}|${r.day.toISOString().slice(0, 10)}|${r.count}`)
      .sort();

  it('replaces stale UTC-bucketed rows with the business-zone days, summing units', async () => {
    const { repo, rebuild } = build([
      order('o1', '2026-11-09T18:30:00Z', [item('a', 3)]), // 01:30 WIB on the 10th
      order('o2', '2026-11-10T03:00:00Z', [item('a'), item('b', 2)]), // 10:00 WIB on the 10th
      order('o3', '2026-11-09T16:00:00Z', [item('a')]), // 23:00 WIB on the 9th
    ]);
    // What the old UTC bucketing left behind (o1 counted on the 9th).
    repo.dailySales.push({ productId: 'a', depotId: 'dep-1', day: new Date('2026-11-09T00:00:00Z'), count: 4 });

    const out = await rebuild.rebucketDailySales(100);

    expect(out).toEqual({ orders: 3, rows: 3 });
    expect(days(repo)).toEqual(['a|dep-1|2026-11-09|1', 'a|dep-1|2026-11-10|4', 'b|dep-1|2026-11-10|2']);
  });

  it('keeps depot-less orders apart from depot ones, and counts a product on two lines once per unit', async () => {
    const { repo, rebuild } = build([
      order('o1', '2026-11-10T03:00:00Z', [item('a', 1), item('a', 2)], null),
      order('o2', '2026-11-10T03:00:00Z', [item('a', 1)], 'dep-1'),
    ]);
    await rebuild.rebucketDailySales(1);
    expect(days(repo)).toEqual(['a|dep-1|2026-11-10|1', 'a|null|2026-11-10|3']);
  });

  it('walks a paged feed to the end', async () => {
    const { repo, rebuild } = build([
      order('o1', '2026-11-10T03:00:00Z', [item('a')]),
      order('o2', '2026-11-10T04:00:00Z', [item('a')]),
      order('o3', '2026-11-10T05:00:00Z', [item('a')]),
    ]);
    expect(await rebuild.rebucketDailySales(1)).toEqual({ orders: 3, rows: 1 });
    expect(days(repo)).toEqual(['a|dep-1|2026-11-10|3']);
  });

  it('an empty feed leaves the table alone rather than wiping it', async () => {
    const { repo, rebuild } = build([]);
    repo.dailySales.push({ productId: 'a', depotId: null, day: new Date('2026-11-09T00:00:00Z'), count: 4 });
    expect(await rebuild.rebucketDailySales(100)).toEqual({ orders: 0, rows: 0 });
    expect(repo.dailySales).toHaveLength(1);
  });
});
