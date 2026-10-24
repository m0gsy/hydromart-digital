import { randomUUID } from 'node:crypto';

import { CAPABILITY_KEY } from '@hydromart/platform';

import {
  UNSETTLED_AGING_BUCKETS,
  PaymentService,
} from '../../src/application/services/payment.service';
import { PaymentController } from '../../src/modules/payment.controller';
import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  buildTestConfig,
} from '../support/fakes';

/**
 * How long money has been waiting, for the finance heatmap. The age of a payment is counted in
 * WIB calendar days, not in 24-hour blocks and not in UTC days: a payment made at 03:00 WIB is
 * already "yesterday" in UTC, and a bucket that said so would age it a day early.
 */
describe('PaymentService.unsettledAging', () => {
  let repo: InMemoryPaymentRepository;
  let service: PaymentService;
  const customer = randomUUID();
  // 2026-10-15 12:00 WIB.
  const NOW = new Date('2026-10-15T05:00:00.000Z');

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    const orders = new FakeOrderCoordination();
    orders.orderCustomerId = customer;
    service = new PaymentService(repo, new FakeGateway(), orders, buildTestConfig());
  });

  /** A pending payment `daysAgo` WIB calendar days before NOW, at noon so no boundary is crossed. */
  const pending = async (method: PaymentMethod, amount: number, daysAgo: number) => {
    const p = await service.initiate(customer, { orderId: randomUUID(), method, amount });
    const row = repo.rows.find((r) => r.id === p.id)!;
    row.createdAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return row;
  };
  const row = (aging: Awaited<ReturnType<PaymentService['unsettledAging']>>, m: PaymentMethod) =>
    aging.rows.find((r) => r.method === m);

  it('names the buckets once, here, so the screen never invents a boundary', async () => {
    const out = await service.unsettledAging(NOW);
    expect(out.buckets).toEqual(['0-1', '2-3', '4-7', '8+']);
    expect(out.buckets).toEqual([...UNSETTLED_AGING_BUCKETS]);
    expect(out.asOf).toBe(NOW.toISOString());
    expect(out.rows).toEqual([]);
  });

  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 2],
    [7, 2],
    [8, 3],
    [90, 3],
  ])('puts a payment %i days old in bucket %i', async (daysAgo, bucket) => {
    await pending(PaymentMethod.QRIS, 10_000, daysAgo);
    const r = row(await service.unsettledAging(NOW), PaymentMethod.QRIS)!;
    expect(r.counts[bucket]).toBe(1);
    expect(r.amounts[bucket]).toBe(10_000);
    // …and nowhere else.
    expect(r.counts.reduce((n, c) => n + c, 0)).toBe(1);
  });

  it('counts the age in WIB calendar days: 03:00 WIB is the same day as noon, though UTC says otherwise', async () => {
    const p = await pending(PaymentMethod.CASH, 5_000, 0);
    // 2026-10-14T20:00Z is 2026-10-15 03:00 WIB, the same WIB day as NOW; the UTC dates differ.
    p.createdAt = new Date('2026-10-14T20:00:00.000Z');
    const r = row(await service.unsettledAging(NOW), PaymentMethod.CASH)!;
    expect(r.counts[0]).toBe(1);
    // One minute earlier is the previous WIB day: age 1, still the first bucket.
    p.createdAt = new Date('2026-10-14T16:59:00.000Z');
    expect(row(await service.unsettledAging(NOW), PaymentMethod.CASH)!.counts[0]).toBe(1);
    // Two WIB days back crosses into the next bucket.
    p.createdAt = new Date('2026-10-13T16:59:00.000Z');
    expect(row(await service.unsettledAging(NOW), PaymentMethod.CASH)!.counts[1]).toBe(1);
  });

  it('sums amounts and counts per method and bucket', async () => {
    await pending(PaymentMethod.TRANSFER, 100_000, 0);
    await pending(PaymentMethod.TRANSFER, 50_000, 1);
    await pending(PaymentMethod.TRANSFER, 25_000, 10);
    await pending(PaymentMethod.QRIS, 7_000, 5);
    const out = await service.unsettledAging(NOW);
    const t = row(out, PaymentMethod.TRANSFER)!;
    expect(t.amounts).toEqual([150_000, 0, 0, 25_000]);
    expect(t.counts).toEqual([2, 0, 0, 1]);
    expect(row(out, PaymentMethod.QRIS)!.amounts).toEqual([0, 0, 7_000, 0]);
    // A method with nothing waiting has no row.
    expect(row(out, PaymentMethod.VA)).toBeUndefined();
  });

  it('counts only what is still waiting: paid, failed and refunded money is not aged', async () => {
    const a = await pending(PaymentMethod.QRIS, 1_000, 3);
    const b = await pending(PaymentMethod.QRIS, 2_000, 3);
    const c = await pending(PaymentMethod.QRIS, 4_000, 3);
    a.status = PaymentStatus.PAID;
    b.status = PaymentStatus.FAILED;
    const r = row(await service.unsettledAging(NOW), PaymentMethod.QRIS)!;
    expect(r.amounts[1]).toBe(c.amount);
    expect(r.counts[1]).toBe(1);
  });

  it('never ages a payment into the future', async () => {
    const p = await pending(PaymentMethod.CASH, 1_000, 0);
    p.createdAt = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(row(await service.unsettledAging(NOW), PaymentMethod.CASH)!.counts[0]).toBe(1);
  });
});

describe('PaymentController.unsettledAging', () => {
  it('hands the answer through and is gated by the settlement capability', async () => {
    const aging = { asOf: 'x', buckets: [], rows: [] };
    const svc = { unsettledAging: jest.fn().mockResolvedValue(aging) };
    const controller = Object.create(PaymentController.prototype) as PaymentController;
    (controller as unknown as { payments: unknown }).payments = svc;
    await expect(controller.unsettledAging()).resolves.toBe(aging);
    expect(svc.unsettledAging).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(CAPABILITY_KEY, PaymentController.prototype.unsettledAging)).toBe(
      'settlementRead',
    );
  });
});
