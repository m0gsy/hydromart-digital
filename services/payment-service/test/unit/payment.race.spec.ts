import { randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import {
  GatewayUnavailableError,
  InvalidPaymentTransitionError,
  OrderNotPayableError,
  PaymentNotRefundableError,
  RefundNotPendingError,
} from '../../src/domain/errors';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  buildTestConfig,
} from '../support/fakes';

/*
 * The service reads a payment, decides in memory, then writes. Another actor (a cancel, the
 * expiry sweep, a cashier, the webhook) can commit between the read and the write; the writes
 * used to be `update({where:{id}})`, so the later one silently won. They are now
 * compare-and-set on PENDING.
 *
 * `settleFirst` makes that interleaving deterministic: it lets the OTHER actor commit
 * immediately before the service's compare-and-set runs, which is exactly the window.
 */
describe('PaymentService — lost races on the PENDING transitions', () => {
  let repo: InMemoryPaymentRepository;
  let orders: FakeOrderCoordination;
  let gateway: FakeGateway;
  let service: PaymentService;
  const customer = randomUUID();

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    gateway = new FakeGateway();
    orders = new FakeOrderCoordination();
    service = new PaymentService(repo, gateway, orders, buildTestConfig());
  });

  const initiate = (method: PaymentMethod, orderId = randomUUID()) =>
    service.initiate(customer, { orderId, method, amount: 45000 });

  const settleFirst = (id: string, patch: Partial<(typeof repo.rows)[number]>) => {
    const real = repo.updateIfStatus.bind(repo);
    let armed = true;
    jest.spyOn(repo, 'updateIfStatus').mockImplementation(async (...args) => {
      if (armed) {
        armed = false;
        Object.assign(repo.rows.find((r) => r.id === id)!, patch);
      }
      return real(...args);
    });
  };

  it('confirm loses to a payment that was failed meanwhile: conflict, row stays FAILED, order not confirmed', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    settleFirst(payment.id, { status: PaymentStatus.FAILED, failedAt: new Date() });

    await expect(service.confirm(payment.id, 'kasir', 50000)).rejects.toBeInstanceOf(
      InvalidPaymentTransitionError,
    );

    expect(repo.rows.find((r) => r.id === payment.id)!.status).toBe(PaymentStatus.FAILED);
    expect(orders.confirmedOrderIds).toEqual([]);
  });

  it('confirm that loses to the SAME confirmation is answered as a replay, without confirming twice', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    settleFirst(payment.id, {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      cashReceived: 50000,
      changeGiven: 5000,
    });

    const result = await service.confirm(payment.id, 'kurir', 50000);

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(orders.confirmedOrderIds).toEqual([]);
  });

  it('confirm that loses to a DIFFERENT cash figure still conflicts', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    settleFirst(payment.id, {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      cashReceived: 60000,
      changeGiven: 15000,
    });

    await expect(service.confirm(payment.id, 'kurir', 50000)).rejects.toBeInstanceOf(
      InvalidPaymentTransitionError,
    );
  });

  it('fail loses to a confirmation: conflict, no rejection notice, row stays PAID', async () => {
    const payment = await initiate(PaymentMethod.TRANSFER);
    settleFirst(payment.id, { status: PaymentStatus.PAID, paidAt: new Date() });

    await expect(service.fail(payment.id, 'staff')).rejects.toBeInstanceOf(
      InvalidPaymentTransitionError,
    );

    expect(repo.rows.find((r) => r.id === payment.id)!.status).toBe(PaymentStatus.PAID);
    expect(orders.notices).toEqual([]);
  });

  it('cancelForOrder that loses to a cash confirmation refunds it instead of failing PAID money', async () => {
    const orderId = randomUUID();
    const payment = await initiate(PaymentMethod.CASH, orderId);
    settleFirst(payment.id, {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      cashReceived: 50000,
      changeGiven: 5000,
    });

    const settled = await service.cancelForOrder(orderId, 'Dibatalkan', 'order-service');

    // Before: markFailed overwrote PAID with FAILED — cash taken, nothing refunded, ever.
    expect(settled?.status).toBe(PaymentStatus.REFUNDED);
    expect(settled?.refundedAmount).toBe(45000);
  });

  it('voidForOrder that loses to a cash confirmation refunds it too', async () => {
    const orderId = randomUUID();
    const payment = await initiate(PaymentMethod.CASH, orderId);
    settleFirst(payment.id, {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      cashReceived: 50000,
      changeGiven: 5000,
    });

    const voided = await service.voidForOrder(orderId, 'Salah ukuran', 'order-service');

    expect(voided?.status).toBe(PaymentStatus.REFUNDED);
  });

  it('cancelForOrder that loses to a concurrent FAILED has nothing left to do', async () => {
    const orderId = randomUUID();
    const payment = await initiate(PaymentMethod.TRANSFER, orderId);
    settleFirst(payment.id, { status: PaymentStatus.FAILED, failedAt: new Date() });

    expect(await service.cancelForOrder(orderId, 'Batal', 'order-service')).toBeNull();
  });

  it('voidForOrder that loses to a concurrent FAILED has nothing left to void', async () => {
    const orderId = randomUUID();
    const payment = await initiate(PaymentMethod.CASH, orderId);
    settleFirst(payment.id, { status: PaymentStatus.FAILED, failedAt: new Date() });

    expect(await service.voidForOrder(orderId, 'Batal', 'order-service')).toBeNull();
  });

  describe('initiate on an order that is already over', () => {
    const open = async (status?: string) => {
      const orderId = randomUUID();
      orders.orderTotal = 45000;
      orders.orderCustomerId = customer;
      if (status) orders.orderStatuses.set(orderId, status);
      return { orderId, call: () => initiate(PaymentMethod.CASH, orderId) };
    };

    it.each(['CANCELLED', 'VOIDED'])('refuses a payment on a %s order', async (status) => {
      const { call } = await open(status);
      await expect(call()).rejects.toBeInstanceOf(OrderNotPayableError);
      expect(repo.rows).toHaveLength(0);
    });

    it('still lets a live order pay, and an unreadable status fails soft', async () => {
      await expect((await open('CONFIRMED')).call()).resolves.toMatchObject({
        status: PaymentStatus.PENDING,
      });
      await expect((await open()).call()).resolves.toMatchObject({
        status: PaymentStatus.PENDING,
      });
    });
  });

  describe('refund requests', () => {
    // 150k is over the approval threshold the test config uses, so refund() queues for HQ.
    const queued = async () => {
      const orderId = randomUUID();
      const payment = await service.initiate(customer, {
        orderId,
        method: PaymentMethod.VA,
        amount: 150_000,
      });
      await service.confirm(payment.id, 'staff');
      await service.refund(payment.id, 'finance', 'pesanan salah');
      orders.orderStatuses.set(orderId, 'DELIVERED');
      return payment;
    };

    it('rejectRefund that loses to an approval does not write PAID back over a refunded payment', async () => {
      const payment = await queued();
      // The approval commits (REFUNDED, APPROVED) right before the reject's compare-and-set.
      settleFirst(payment.id, {
        status: PaymentStatus.REFUNDED,
        refundApproval: RefundApproval.APPROVED,
      });

      await expect(service.rejectRefund(payment.id, 'hq', 'tidak valid')).rejects.toBeInstanceOf(
        RefundNotPendingError,
      );

      const row = repo.rows.find((r) => r.id === payment.id)!;
      expect(row.status).toBe(PaymentStatus.REFUNDED);
      expect(row.refundApproval).toBe(RefundApproval.APPROVED);
    });

    it('approveRefund that loses to a rejection is refused and the gateway is never reached', async () => {
      const payment = await queued();
      const refund = jest.spyOn(gateway, 'refund');
      settleFirst(payment.id, { refundApproval: RefundApproval.REJECTED });

      await expect(service.approveRefund(payment.id, 'hq')).rejects.toBeInstanceOf(
        RefundNotPendingError,
      );

      expect(refund).not.toHaveBeenCalled();
      expect(repo.rows.find((r) => r.id === payment.id)!.status).toBe(PaymentStatus.PAID);
    });

    it('a second refund request that loses to the first returns the first, not a conflict', async () => {
      const orderId = randomUUID();
      const payment = await service.initiate(customer, {
        orderId,
        method: PaymentMethod.VA,
        amount: 150_000,
      });
      await service.confirm(payment.id, 'staff');
      // Another request lands (PENDING) between this caller's read and its queue write.
      settleFirst(payment.id, { refundApproval: RefundApproval.PENDING, refundReason: 'pertama' });

      const result = await service.refund(payment.id, 'finance', 'kedua');

      expect(result.refundApproval).toBe(RefundApproval.PENDING);
      expect(result.refundReason).toBe('pertama');
    });

    it('a refund that loses the queue write to a settlement does not resurrect PAID', async () => {
      const orderId = randomUUID();
      const payment = await service.initiate(customer, {
        orderId,
        method: PaymentMethod.VA,
        amount: 150_000,
      });
      await service.confirm(payment.id, 'staff');
      settleFirst(payment.id, { status: PaymentStatus.REFUNDED, refundedAmount: 150_000 });

      await expect(service.refund(payment.id, 'finance', 'x')).rejects.toBeInstanceOf(
        PaymentNotRefundableError,
      );
      expect(repo.rows.find((r) => r.id === payment.id)!.status).toBe(PaymentStatus.REFUNDED);
    });

    it('records no requester when the refund is raised without one', async () => {
      const payment = await service.initiate(customer, {
        orderId: randomUUID(),
        method: PaymentMethod.VA,
        amount: 150_000,
      });
      await service.confirm(payment.id, 'staff');

      const queuedRow = await service.refund(payment.id, '', 'x');

      expect(queuedRow.refundRequestedBy).toBeNull();
    });

    it('loudly reports a claim that could not be handed back after a gateway failure', async () => {
      const payment = await queued();
      gateway.throwOnRefund = true;
      const real = repo.updateIfStatus.bind(repo);
      let calls = 0;
      jest.spyOn(repo, 'updateIfStatus').mockImplementation(async (...args) => {
        calls += 1;
        return calls === 1 ? real(...args) : null; // the claim lands, the revert does not
      });

      await expect(service.approveRefund(payment.id, 'hq')).rejects.toBeInstanceOf(
        GatewayUnavailableError,
      );
      expect(repo.rows.find((r) => r.id === payment.id)!.status).toBe(PaymentStatus.REFUNDED);
    });

    it('settles with the claimed row when the post-gateway write finds it already moved', async () => {
      const payment = await queued();
      const real = repo.updateIfStatus.bind(repo);
      let calls = 0;
      jest.spyOn(repo, 'updateIfStatus').mockImplementation(async (...args) => {
        calls += 1;
        return calls === 1 ? real(...args) : null;
      });

      const settled = await service.approveRefund(payment.id, 'hq');

      expect(settled.status).toBe(PaymentStatus.REFUNDED);
    });

    it('a gateway failure hands the claim back with the queued amount and reason intact', async () => {
      const payment = await queued();
      gateway.throwOnRefund = true;

      await expect(service.approveRefund(payment.id, 'hq')).rejects.toBeInstanceOf(
        GatewayUnavailableError,
      );

      const row = repo.rows.find((r) => r.id === payment.id)!;
      expect(row.status).toBe(PaymentStatus.PAID);
      expect(row.refundApproval).toBe(RefundApproval.PENDING);
      // Before: the revert dropped these, destroying the request approveRefund was working from.
      expect(row.refundedAmount).toBe(150_000);
      expect(row.refundReason).toBe('pesanan salah');
    });
  });
});
