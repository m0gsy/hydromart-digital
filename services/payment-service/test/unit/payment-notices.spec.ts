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

  describe('flagUnconfirmed', () => {
    const paidMinutesAgo = async (method: PaymentMethod, minutes: number) => {
      const row = await seedPending(method, hoursAgo(80));
      await repo.update(row.id, {
        status: PaymentStatus.PAID,
        paidAt: new Date(Date.now() - minutes * 60_000),
      });
      return row;
    };

    it('tells the depot when money arrived but the order is still CREATED', async () => {
      const row = await paidMinutesAgo(PaymentMethod.TRANSFER, 45);
      orders.orderStatuses.set(row.orderId, 'CREATED');
      expect(await service.flagUnconfirmed(new Date())).toEqual({ flagged: 1, failed: 0, reconciled: 0, ok: true });
      expect(orders.notices).toEqual([{ orderId: row.orderId, kind: 'UNCONFIRMED', amount: 45000 }]);
    });

    it('says it once however often the sweep runs', async () => {
      const row = await paidMinutesAgo(PaymentMethod.TRANSFER, 45);
      orders.orderStatuses.set(row.orderId, 'CREATED');
      await service.flagUnconfirmed(new Date());
      await service.flagUnconfirmed(new Date());
      expect(orders.notices).toHaveLength(1);
    });

    it('catches up on a payment an earlier sweep never reached', async () => {
      const row = await paidMinutesAgo(PaymentMethod.TRANSFER, 5 * 60); // five hours ago
      orders.orderStatuses.set(row.orderId, 'CREATED');
      expect((await service.flagUnconfirmed(new Date())).flagged).toBe(1);
    });

    describe('money PAID on an order that was cancelled meanwhile', () => {
      it('hands it to the refund path, once, and leaves live orders alone', async () => {
        const stranded = await paidMinutesAgo(PaymentMethod.TRANSFER, 10);
        orders.orderStatuses.set(stranded.orderId, 'CANCELLED');
        const live = await paidMinutesAgo(PaymentMethod.TRANSFER, 10);
        orders.orderStatuses.set(live.orderId, 'PREPARING');
        const unknown = await paidMinutesAgo(PaymentMethod.QRIS, 10); // status unreadable

        const out = await service.flagUnconfirmed(new Date());

        expect(out.reconciled).toBe(1);
        expect((await repo.findById(stranded.id))?.status).not.toBe(PaymentStatus.PAID);
        expect((await repo.findById(live.id))?.status).toBe(PaymentStatus.PAID);
        expect((await repo.findById(unknown.id))?.status).toBe(PaymentStatus.PAID);
        // Already refunded: the next sweep finds nothing to do.
        expect((await service.flagUnconfirmed(new Date())).reconciled).toBe(0);
      });

      it('treats a voided counter sale the same way', async () => {
        const voided = await paidMinutesAgo(PaymentMethod.TRANSFER, 10);
        orders.orderStatuses.set(voided.orderId, 'VOIDED');
        expect((await service.flagUnconfirmed(new Date())).reconciled).toBe(1);
      });

      it('counts a refund that throws as failed and keeps going', async () => {
        const a = await paidMinutesAgo(PaymentMethod.TRANSFER, 10);
        const b = await paidMinutesAgo(PaymentMethod.TRANSFER, 12);
        orders.orderStatuses.set(a.orderId, 'CANCELLED');
        orders.orderStatuses.set(b.orderId, 'CANCELLED');
        jest.spyOn(service, 'cancelForOrder').mockRejectedValueOnce(new Error('gateway down'));
        const out = await service.flagUnconfirmed(new Date());
        expect(out).toMatchObject({ reconciled: 1, failed: 1, ok: true });
      });

      it('is not ok when every reconciliation failed', async () => {
        const a = await paidMinutesAgo(PaymentMethod.TRANSFER, 10);
        orders.orderStatuses.set(a.orderId, 'CANCELLED');
        jest.spyOn(service, 'cancelForOrder').mockRejectedValue(new Error('gateway down'));
        expect(await service.flagUnconfirmed(new Date())).toMatchObject({ reconciled: 0, failed: 1, ok: false });
      });
    });

    it('stays quiet when the order did confirm, or its status cannot be read', async () => {
      const confirmed = await paidMinutesAgo(PaymentMethod.TRANSFER, 45);
      orders.orderStatuses.set(confirmed.orderId, 'CONFIRMED');
      await paidMinutesAgo(PaymentMethod.QRIS, 50); // no status known for this one
      expect((await service.flagUnconfirmed(new Date())).flagged).toBe(0);
      expect(orders.notices).toHaveLength(0);
    });

    it('leaves a payment that is still fresh, and one from before the two-day lookback', async () => {
      for (const minutes of [10, 3 * 24 * 60]) {
        const row = await paidMinutesAgo(PaymentMethod.TRANSFER, minutes);
        orders.orderStatuses.set(row.orderId, 'CREATED');
      }
      expect((await service.flagUnconfirmed(new Date())).flagged).toBe(0);
    });

    it('does nothing at all when nothing is a candidate', async () => {
      const spy = jest.spyOn(orders, 'getOrderStatuses');
      expect(await service.flagUnconfirmed(new Date())).toEqual({ flagged: 0, failed: 0, reconciled: 0, ok: true });
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not tell twice when another sweep claimed the payment first', async () => {
      const row = await paidMinutesAgo(PaymentMethod.TRANSFER, 45);
      orders.orderStatuses.set(row.orderId, 'CREATED');
      jest.spyOn(repo, 'claimUnconfirmedNotice').mockResolvedValue(false);
      expect((await service.flagUnconfirmed(new Date())).flagged).toBe(0);
      expect(orders.notices).toHaveLength(0);
    });

    it('counts a notice that throws and carries on', async () => {
      const a = await paidMinutesAgo(PaymentMethod.TRANSFER, 45);
      const b = await paidMinutesAgo(PaymentMethod.QRIS, 46);
      orders.orderStatuses.set(a.orderId, 'CREATED');
      orders.orderStatuses.set(b.orderId, 'CREATED');
      jest.spyOn(orders, 'notifyPaymentEvent').mockRejectedValueOnce(new Error('down'));
      expect(await service.flagUnconfirmed(new Date())).toEqual({ flagged: 1, failed: 1, reconciled: 0, ok: true });
    });

    it('reports ok=false when no notice could be sent', async () => {
      const a = await paidMinutesAgo(PaymentMethod.TRANSFER, 45);
      orders.orderStatuses.set(a.orderId, 'CREATED');
      jest.spyOn(orders, 'notifyPaymentEvent').mockRejectedValue(new Error('down'));
      expect(await service.flagUnconfirmed(new Date())).toEqual({ flagged: 0, failed: 1, reconciled: 0, ok: false });
    });
  });

  describe('remindStalePending', () => {
    it('reminds a payment once it is past half its lifetime', async () => {
      // The default TTL is 24h, so anything older than 12h (and younger than 24h) is due.
      const row = await seedPending(PaymentMethod.TRANSFER, hoursAgo(12.5));
      expect(await service.remindStalePending(new Date())).toEqual({
        reminded: 1,
        failed: 0,
        ok: true,
      });
      expect(orders.notices).toEqual([{ orderId: row.orderId, kind: 'REMINDER', amount: 45000 }]);
    });

    it('says it once however often the sweep runs', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(13));
      await service.remindStalePending(new Date());
      await service.remindStalePending(new Date());
      expect(orders.notices).toHaveLength(1);
    });

    it('catches up on a payment a skipped sweep never reached', async () => {
      await seedPending(PaymentMethod.QRIS, hoursAgo(20)); // long past half, not yet expired
      expect((await service.remindStalePending(new Date())).reminded).toBe(1);
    });

    it('leaves a fresh payment, one past its whole lifetime, and CASH alone', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(2));
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(30)); // the expiry sweep owns this one
      await seedPending(PaymentMethod.CASH, hoursAgo(13));
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
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(13));
      expect(await off.remindStalePending(new Date())).toEqual({
        reminded: 0,
        failed: 0,
        ok: true,
      });
    });

    it('does not remind a payment another sweep has already claimed', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(13));
      jest.spyOn(repo, 'claimReminder').mockResolvedValue(false);
      expect((await service.remindStalePending(new Date())).reminded).toBe(0);
      expect(orders.notices).toHaveLength(0);
    });

    it('counts a reminder that throws and carries on with the rest', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(13));
      await seedPending(PaymentMethod.QRIS, hoursAgo(14));
      jest.spyOn(orders, 'notifyPaymentEvent').mockRejectedValueOnce(new Error('order-service down'));
      expect(await service.remindStalePending(new Date())).toEqual({
        reminded: 1,
        failed: 1,
        ok: true,
      });
    });

    it('reports ok=false when nothing could be reminded', async () => {
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(13));
      jest.spyOn(orders, 'notifyPaymentEvent').mockRejectedValue(new Error('down'));
      expect(await service.remindStalePending(new Date())).toEqual({
        reminded: 0,
        failed: 1,
        ok: false,
      });
    });
  });
});
