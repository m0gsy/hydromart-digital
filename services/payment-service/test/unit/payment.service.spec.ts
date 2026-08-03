import { createHmac, randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import {
  CashShortError,
  GatewayUnavailableError,
  InvalidWebhookSignatureError,
  PaymentAlreadyExistsError,
  PaymentAmountMismatchError,
  PaymentNotFoundError,
  PaymentNotRefundableError,
  RefundNotPendingError,
} from '../../src/domain/errors';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  WEBHOOK_SECRET,
  buildTestConfig,
} from '../support/fakes';

describe('PaymentService', () => {
  let repo: InMemoryPaymentRepository;
  let gateway: FakeGateway;
  let orders: FakeOrderCoordination;
  let service: PaymentService;
  const customer = randomUUID();

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    gateway = new FakeGateway();
    orders = new FakeOrderCoordination();
    service = new PaymentService(repo, gateway, orders, buildTestConfig());
  });

  const initiate = (method: PaymentMethod, amount = 45000, orderId = randomUUID()) =>
    service.initiate(customer, { orderId, method, amount });

  it('initiates a cash payment as PENDING with no gateway call', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.reference).toBeNull();
    expect(payment.instruction).toContain('cash');
    expect(gateway.charges).toHaveLength(0);
  });

  it('initiates an online payment with a gateway charge and reference', async () => {
    const payment = await initiate(PaymentMethod.VA);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.reference).toMatch(/^REF-/);
    expect(gateway.charges).toHaveLength(1);
  });

  // QRIS is a manual/direct-to-depot method: depots use their own static QRIS
  // paid directly to the depot and settled by staff via confirm — no gateway.
  it('initiates a QRIS payment as PENDING with no gateway call', async () => {
    const payment = await initiate(PaymentMethod.QRIS);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.reference).toBeNull();
    expect(gateway.charges).toHaveLength(0);
  });

  it('fails closed and marks the payment FAILED when the gateway errors', async () => {
    gateway.throwOnCharge = true;
    await expect(initiate(PaymentMethod.VA)).rejects.toBeInstanceOf(GatewayUnavailableError);
    expect(repo.rows[0].status).toBe(PaymentStatus.FAILED);
  });

  it('rejects a payment whose amount differs from the order total (SEC-1)', async () => {
    orders.orderTotal = 45000;
    await expect(initiate(PaymentMethod.CASH, 1000)).rejects.toBeInstanceOf(
      PaymentAmountMismatchError,
    );
    expect(repo.rows).toHaveLength(0);
  });

  it('accepts a payment whose amount matches the order total (SEC-1)', async () => {
    orders.orderTotal = 45000;
    const payment = await initiate(PaymentMethod.CASH, 45000);
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it('rejects a second active payment for the same order', async () => {
    const orderId = randomUUID();
    await initiate(PaymentMethod.CASH, 45000, orderId);
    await expect(initiate(PaymentMethod.CASH, 45000, orderId)).rejects.toBeInstanceOf(
      PaymentAlreadyExistsError,
    );
  });

  it('confirms a pending payment as PAID', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    const confirmed = await service.confirm(payment.id, 'staff');
    expect(confirmed.status).toBe(PaymentStatus.PAID);
    expect(confirmed.paidAt).not.toBeNull();
    // A settled payment confirms its order (CREATED→CONFIRMED).
    expect(orders.confirmedOrderIds).toEqual([confirmed.orderId]);
  });

  it('records cash tendered and change owed when confirming a COD payment (7a)', async () => {
    const payment = await initiate(PaymentMethod.CASH, 45000);
    const confirmed = await service.confirm(payment.id, 'driver', 50000);
    expect(confirmed.status).toBe(PaymentStatus.PAID);
    expect(confirmed.cashReceived).toBe(50000);
    expect(confirmed.changeGiven).toBe(5000);
  });

  it('rejects a COD confirm when the cash handed over is short', async () => {
    const payment = await initiate(PaymentMethod.CASH, 45000);
    await expect(service.confirm(payment.id, 'driver', 40000)).rejects.toBeInstanceOf(
      CashShortError,
    );
    // Payment stays PENDING — nothing settled.
    expect(repo.rows[0].status).toBe(PaymentStatus.PENDING);
  });

  it('refunds a paid online payment via the gateway (BR: online-paid cancel needs refund)', async () => {
    const payment = await initiate(PaymentMethod.VA);
    await service.confirm(payment.id, 'staff');
    const refunded = await service.refund(payment.id, 'finance', 'order cancelled');
    expect(refunded.status).toBe(PaymentStatus.REFUNDED);
    expect(refunded.refundedAmount).toBe(45000);
    expect(refunded.refundReason).toBe('order cancelled');
    // Notifies order-service so the refund lands on the order's depot (reconciliation 22a).
    expect(orders.refunded).toEqual([{ orderId: payment.orderId, amount: 45000 }]);
  });

  // B-9: refund read the payment, checked isRefundable, called the GATEWAY, and only then
  // wrote — on `id` alone, with no status predicate. Two concurrent refunds both passed the
  // check and both sent money back. These pin the two halves of the fix: the claim happens
  // before anything is spent, and a caller that loses the claim spends nothing.
  it('claims the payment before calling the gateway, never after', async () => {
    const payment = await initiate(PaymentMethod.VA);
    await service.confirm(payment.id, 'staff');

    const order: string[] = [];
    const realClaim = repo.updateIfStatus.bind(repo);
    jest.spyOn(repo, 'updateIfStatus').mockImplementation(async (...args) => {
      order.push('claim');
      return realClaim(...args);
    });
    jest.spyOn(gateway, 'refund').mockImplementation(async (reference, amount) => {
      order.push('gateway');
      return { reference: `RFN-${reference}`, raw: JSON.stringify({ refunded: amount }) };
    });

    await service.refund(payment.id, 'finance');

    expect(order).toEqual(['claim', 'gateway']);
  });

  it('does not pay a customer twice when a second refund loses the claim', async () => {
    const payment = await initiate(PaymentMethod.VA);
    await service.confirm(payment.id, 'staff');

    await service.refund(payment.id, 'finance', 'first');
    expect(gateway.refunds).toHaveLength(1);

    // The loser must be refused, and above all must not reach the gateway a second time.
    await expect(service.refund(payment.id, 'finance', 'second')).rejects.toBeInstanceOf(
      PaymentNotRefundableError,
    );
    expect(gateway.refunds).toHaveLength(1);
  });

  // The single-threaded path can never reach this: by the time a second refund runs, the
  // isRefundable check already rejects it. Losing the CLAIM is the genuinely concurrent
  // case — two callers past that check at the same time — so it is forced here. Without
  // this branch the second caller would fall through and refund again.
  it('refuses a caller that passed the check but lost the claim to a racer', async () => {
    const payment = await initiate(PaymentMethod.VA);
    await service.confirm(payment.id, 'staff');
    jest.spyOn(repo, 'updateIfStatus').mockResolvedValue(null);

    await expect(service.refund(payment.id, 'finance')).rejects.toBeInstanceOf(
      PaymentNotRefundableError,
    );
    expect(gateway.refunds).toHaveLength(0);
  });

  it('hands the claim back when the gateway refuses, so the refund can be retried', async () => {
    const payment = await initiate(PaymentMethod.VA);
    await service.confirm(payment.id, 'staff');
    gateway.throwOnRefund = true;

    await expect(service.refund(payment.id, 'finance')).rejects.toBeInstanceOf(
      GatewayUnavailableError,
    );
    // Still refundable: a failed gateway call must not strand the payment as REFUNDED with
    // the money never sent.
    expect(repo.rows[0].status).toBe(PaymentStatus.PAID);

    gateway.throwOnRefund = false;
    const retried = await service.refund(payment.id, 'finance');
    expect(retried.status).toBe(PaymentStatus.REFUNDED);
    expect(gateway.refunds).toHaveLength(1);
  });

  it('refuses to refund a payment that is not PAID', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    await expect(service.refund(payment.id, 'finance')).rejects.toBeInstanceOf(
      PaymentNotRefundableError,
    );
  });

  // Feature 14a — HQ refund-approval queue (default threshold Rp 100k).
  const paidOver = async (amount: number) => {
    const payment = await initiate(PaymentMethod.VA, amount);
    await service.confirm(payment.id, 'staff');
    return payment;
  };

  it('queues a high-value refund for HQ approval instead of settling immediately', async () => {
    const payment = await paidOver(150_000);
    const queued = await service.refund(payment.id, 'finance', 'galon bocor');
    expect(queued.status).toBe(PaymentStatus.PAID); // not settled yet
    expect(queued.refundApproval).toBe(RefundApproval.PENDING);
    expect(queued.refundReason).toBe('galon bocor');

    const list = await service.listRefundQueue({});
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(payment.id);
  });

  it('approving a queued refund settles it and clears the queue', async () => {
    const payment = await paidOver(150_000);
    await service.refund(payment.id, 'finance', 'galon bocor');
    const approved = await service.approveRefund(payment.id, 'hq');
    expect(approved.status).toBe(PaymentStatus.REFUNDED);
    expect(approved.refundApproval).toBe(RefundApproval.APPROVED);
    expect(approved.refundedAmount).toBe(150_000);
    expect(orders.refunded).toEqual([{ orderId: payment.orderId, amount: 150_000 }]);
    expect((await service.listRefundQueue({})).total).toBe(0);
  });

  it('rejecting a queued refund leaves the payment PAID and unrefunded', async () => {
    const payment = await paidOver(150_000);
    await service.refund(payment.id, 'finance');
    const rejected = await service.rejectRefund(payment.id, 'hq', 'tidak valid');
    expect(rejected.status).toBe(PaymentStatus.PAID);
    expect(rejected.refundApproval).toBe(RefundApproval.REJECTED);
    expect((await service.listRefundQueue({})).total).toBe(0);
  });

  it('refunds at/under the threshold immediately (no approval needed)', async () => {
    const payment = await paidOver(80_000);
    const refunded = await service.refund(payment.id, 'finance');
    expect(refunded.status).toBe(PaymentStatus.REFUNDED);
    expect(refunded.refundApproval).toBe(RefundApproval.NONE);
  });

  it('rejects approving a refund that is not pending', async () => {
    const payment = await paidOver(80_000);
    await expect(service.approveRefund(payment.id, 'hq')).rejects.toBeInstanceOf(
      RefundNotPendingError,
    );
  });

  // Design 6a — settlement dashboard aggregate (unsettled = PENDING).
  it('groups unsettled payments by method with amount + count, excluding settled', async () => {
    await initiate(PaymentMethod.CASH, 10_000);
    await initiate(PaymentMethod.CASH, 5_000);
    await initiate(PaymentMethod.QRIS, 20_000);
    const paid = await initiate(PaymentMethod.VA, 99_000);
    await service.confirm(paid.id, 'staff'); // now PAID → excluded

    const rows = await service.unsettledByMethod({});
    const byMethod = Object.fromEntries(rows.map((r) => [r.method, r]));
    expect(byMethod[PaymentMethod.CASH]).toEqual({
      method: PaymentMethod.CASH,
      amount: 15_000,
      count: 2,
    });
    expect(byMethod[PaymentMethod.QRIS]).toEqual({
      method: PaymentMethod.QRIS,
      amount: 20_000,
      count: 1,
    });
    expect(byMethod[PaymentMethod.VA]).toBeUndefined();
  });

  it("never reveals another customer's payment (cross-tenant 404)", async () => {
    const payment = await initiate(PaymentMethod.CASH);
    await expect(service.getForCustomer(randomUUID(), payment.id)).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('settles a payment from a validly-signed webhook', async () => {
    const payment = await initiate(PaymentMethod.VA);
    const reference = payment.reference!;
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${reference}.PAID`)
      .digest('hex');
    const result = await service.handleWebhook({ reference, event: 'PAID', signature });
    expect(result.handled).toBe(true);
    expect(repo.rows[0].status).toBe(PaymentStatus.PAID);
    // The PAID webhook confirms the order too.
    expect(orders.confirmedOrderIds).toEqual([payment.orderId]);
  });

  it('does not confirm the order when a webhook settles FAILED', async () => {
    const payment = await initiate(PaymentMethod.VA);
    const reference = payment.reference!;
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${reference}.FAILED`)
      .digest('hex');
    const result = await service.handleWebhook({ reference, event: 'FAILED', signature });
    expect(result.handled).toBe(true);
    expect(repo.rows[0].status).toBe(PaymentStatus.FAILED);
    expect(orders.confirmedOrderIds).toEqual([]);
  });

  it('rejects a webhook with a bad signature', async () => {
    const payment = await initiate(PaymentMethod.VA);
    await expect(
      service.handleWebhook({
        reference: payment.reference!,
        event: 'PAID',
        signature: 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('ignores a webhook for an unknown reference (idempotent)', async () => {
    const signature = createHmac('sha256', WEBHOOK_SECRET).update('nope.PAID').digest('hex');
    const result = await service.handleWebhook({ reference: 'nope', event: 'PAID', signature });
    expect(result.handled).toBe(false);
  });

  describe('cashCollected (courier COD deposit)', () => {
    const settleCash = async (amount: number) => {
      const orderId = randomUUID();
      const p = await initiate(PaymentMethod.CASH, amount, orderId);
      await service.confirm(p.id, customer);
      return orderId;
    };

    it('sums only PAID cash over the requested orders', async () => {
      const a = await settleCash(45000);
      const b = await settleCash(30000);
      // Excluded: a different order not requested.
      await settleCash(99000);

      expect(await service.cashCollected([a, b])).toEqual({ total: 75000, count: 2 });
    });

    it('ignores unpaid cash and non-cash methods', async () => {
      const pendingCash = randomUUID();
      await initiate(PaymentMethod.CASH, 45000, pendingCash); // stays PENDING
      const va = await initiate(PaymentMethod.VA, 45000);
      await service.confirm(va.id, customer); // PAID but not cash

      expect(await service.cashCollected([pendingCash, va.orderId])).toEqual({
        total: 0,
        count: 0,
      });
    });

    it('returns zero for an empty order set', async () => {
      expect(await service.cashCollected([])).toEqual({ total: 0, count: 0 });
    });
  });

  describe('voidForOrder', () => {
    it('refunds a settled counter sale straight through, never via the approval queue', async () => {
      const orderId = randomUUID();
      const payment = await initiate(PaymentMethod.CASH, 45000, orderId);
      await service.confirm(payment.id, 'cashier-1', 50000);

      const voided = await service.voidForOrder(orderId, 'Salah ukuran', 'order-service');

      expect(voided?.status).toBe(PaymentStatus.REFUNDED);
      expect(voided?.refundApproval).toBe(RefundApproval.NONE);
      expect(voided?.refundedAmount).toBe(45000);
    });

    // A PENDING counter payment collected nothing, so there is nothing to hand back —
    // refunding it would report money returned that never arrived.
    it('fails an unsettled payment rather than refunding it', async () => {
      const orderId = randomUUID();
      await initiate(PaymentMethod.CASH, 45000, orderId);

      const voided = await service.voidForOrder(orderId, 'Batal', 'order-service');

      expect(voided?.status).toBe(PaymentStatus.FAILED);
      expect(voided?.refundedAmount).toBeNull();
    });

    // The sale was recorded and the money leg never landed — exactly what the cashier is
    // cleaning up. Not an error, and the void must still go through.
    it('reports null when the order never had an active payment', async () => {
      expect(await service.voidForOrder(randomUUID(), 'Batal', 'order-service')).toBeNull();
    });

    it('drops the sale out of the depot cash total once reversed', async () => {
      const orderId = randomUUID();
      const depotId = randomUUID();
      const payment = await service.initiate(customer, {
        orderId,
        method: PaymentMethod.CASH,
        amount: 45000,
        depotId,
      });
      await service.confirm(payment.id, 'cashier-1', 45000);
      expect((await service.depotCashCollected(depotId, {})).total).toBe(45000);

      await service.voidForOrder(orderId, 'Batal', 'order-service');

      // This is what makes the cashier's drawer add up: the reversed sale stops counting
      // toward what they are expected to hold.
      expect((await service.depotCashCollected(depotId, {})).total).toBe(0);
    });
  });
});
