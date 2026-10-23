import { randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  buildTestConfig,
} from '../support/fakes';

/*
 * Payment notices. The buyer hears of a failure and of a payment that is nearly out of time;
 * the depot hears of a receipt waiting to be verified. A cancellation reaches the same FAILED
 * transition and must say nothing - the order's own cancellation notice already covers it.
 */
describe('payment notices', () => {
  let repo: InMemoryPaymentRepository;
  let orders: FakeOrderCoordination;
  let gateway: FakeGateway;
  let service: PaymentService;
  const customer = randomUUID();

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    gateway = new FakeGateway();
    orders = new FakeOrderCoordination();
    orders.orderCustomerId = customer;
    service = new PaymentService(repo, gateway, orders, buildTestConfig());
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  const initiate = (method: PaymentMethod) =>
    service.initiate(customer, { orderId: randomUUID(), method, amount: 45000 });

  const seedPending = async (method: PaymentMethod, createdAt: Date) => {
    const row = await repo.create({
      orderId: randomUUID(),
      customerId: customer,
      method,
      amount: 45000,
      reference: null,
      instruction: null,
      gatewayData: null,
      depotId: null,
      cashierShiftId: null,
    });
    repo.rows.find((r) => r.id === row.id)!.createdAt = createdAt;
    return row;
  };

  it('tells the buyer when staff reject their payment', async () => {
    const p = await initiate(PaymentMethod.TRANSFER);
    await service.fail(p.id, 'staff-1');
    expect(orders.notices).toEqual([
      { orderId: p.orderId, kind: 'FAILED', amount: 45000, reason: 'REJECTED' },
    ]);
  });

  it('says nothing when a cancellation fails the pending payment', async () => {
    const p = await initiate(PaymentMethod.TRANSFER);
    await service.cancelForOrder(p.orderId, 'ganti hari', 'order-service');
    const q = await initiate(PaymentMethod.QRIS);
    await service.voidForOrder(q.orderId, 'salah input', 'kasir');
    expect(orders.notices).toHaveLength(0);
  });

  it('tells the buyer when a stale payment expires', async () => {
    const row = await seedPending(PaymentMethod.QRIS, hoursAgo(30));
    await service.expireStalePending(new Date());
    expect(orders.notices).toEqual([
      { orderId: row.orderId, kind: 'FAILED', amount: 45000, reason: 'EXPIRED' },
    ]);
  });

  it('does not announce a failure for a payment that was settled mid-sweep', async () => {
    const row = await seedPending(PaymentMethod.QRIS, hoursAgo(30));
    jest.spyOn(repo, 'findStalePending').mockImplementation(async () => {
      await repo.update(row.id, { status: PaymentStatus.PAID, paidAt: new Date() });
      return [{ ...row }];
    });
    await service.expireStalePending(new Date());
    expect(orders.notices).toHaveLength(0);
  });

  it('tells the depot when the first receipt lands on a pending payment', async () => {
    const p = await initiate(PaymentMethod.TRANSFER);
    await service.attachProof(customer, p.id, 'https://files/receipt.jpg');
    expect(orders.notices).toEqual([{ orderId: p.orderId, kind: 'PROOF_UPLOADED', amount: 45000 }]);
  });

  it('does not page the depot again for a re-upload, nor for a settled payment', async () => {
    const p = await initiate(PaymentMethod.TRANSFER);
    await service.attachProof(customer, p.id, 'https://files/a.jpg');
    await service.attachProof(customer, p.id, 'https://files/b.jpg');
    expect(orders.notices).toHaveLength(1);

    const paid = await initiate(PaymentMethod.TRANSFER);
    await service.confirm(paid.id, 'staff-1');
    orders.notices.length = 0;
    await service.attachProof(customer, paid.id, 'https://files/c.jpg');
    expect(orders.notices).toHaveLength(0);
  });

  describe('remindStalePending', () => {
    it('reminds a payment in the hour after it passes half its lifetime', async () => {
      // The default TTL is 24h, so the window is ages 12h-13h.
      const row = await seedPending(PaymentMethod.TRANSFER, hoursAgo(12.5));
      expect(await service.remindStalePending(new Date())).toEqual({
        reminded: 1,
        failed: 0,
        ok: true,
      });
      expect(orders.notices).toEqual([{ orderId: row.orderId, kind: 'REMINDER', amount: 45000 }]);
    });

    it('leaves a fresh payment, an older one, and CASH alone', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(2));
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(11));
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(20));
      await seedPending(PaymentMethod.CASH, hoursAgo(12.5));
      expect((await service.remindStalePending(new Date())).reminded).toBe(0);
      expect(orders.notices).toHaveLength(0);
    });

    it('a TTL of zero switches reminders off too', async () => {
      const off = new PaymentService(
        repo,
        gateway,
        orders,
        buildTestConfig({ PAYMENT_PENDING_TTL_HOURS: '0' }),
      );
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(12.5));
      expect(await off.remindStalePending(new Date())).toEqual({
        reminded: 0,
        failed: 0,
        ok: true,
      });
    });

    it('counts a reminder that throws and carries on with the rest', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(12.5));
      await seedPending(PaymentMethod.QRIS, hoursAgo(12.6));
      jest.spyOn(orders, 'notifyPaymentEvent').mockRejectedValueOnce(new Error('order-service down'));
      expect(await service.remindStalePending(new Date())).toEqual({
        reminded: 1,
        failed: 1,
        ok: true,
      });
    });

    it('reports ok=false when nothing could be reminded', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(12.5));
      jest.spyOn(orders, 'notifyPaymentEvent').mockRejectedValue(new Error('down'));
      expect(await service.remindStalePending(new Date())).toEqual({
        reminded: 0,
        failed: 1,
        ok: false,
      });
    });
  });
});
