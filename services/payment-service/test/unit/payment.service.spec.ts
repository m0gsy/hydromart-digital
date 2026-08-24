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

  // Depot reconciliation: the console sends the ids of one page of its own orders, and a
  // repeated id must not cost the query twice — the DTO's bound is on what was sent, so a
  // caller repeating one order 100 times would otherwise read 100 orders' worth.
  it('listForOrders reads each order once, however often it was asked for', async () => {
    const orderId = randomUUID();
    await initiate(PaymentMethod.CASH, 45000, orderId);
    const spy = jest.spyOn(repo, 'findByOrderIds');
    const rows = await service.listForOrders([orderId, orderId]);
    expect(rows).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith([orderId]);
  });

  /*
   * Fraud scan (15b). The floor of two is here and not in the DTO on purpose: a caller
   * asking for "customers with 1 or more refunds" is asking for a customer list, and this
   * route answers a review queue.
   */
  it('never reports below two refunds, however low the caller asks', async () => {
    const spy = jest.spyOn(repo, 'refundCountsByCustomer').mockResolvedValue([]);
    const from = new Date('2026-07-01');
    const to = new Date('2026-08-01');

    await service.refundCountsByCustomer(from, to, 1);
    expect(spy).toHaveBeenCalledWith(from, to, 2);

    await service.refundCountsByCustomer(from, to, 5);
    expect(spy).toHaveBeenLastCalledWith(from, to, 5);
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

  // §G-3: a payment row holds only the order id, so this was the one money screen that
  // asked HQ to decide against eight hex characters.
  it('carries the order number on each queued refund, and copes without one', async () => {
    const payment = await paidOver(150_000);
    await service.refund(payment.id, 'finance', 'galon bocor');
    orders.orderNumbers.set(payment.orderId, 'HM-20260806-1000001');

    expect((await service.listRefundQueue({})).items[0].orderNumber).toBe('HM-20260806-1000001');

    // order-service unreachable: the queue still answers, without the number.
    orders.orderNumbers.clear();
    expect((await service.listRefundQueue({})).items[0].orderNumber).toBeNull();
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

  // H-29: every one of these decisions used to leave nothing behind but a log line that
  // rotates. "Who approved the Rp 2,000,000 refund" has to be answerable from a table.
  describe('audit trail', () => {
    const auditedService = () =>
      new PaymentService(
        repo,
        gateway,
        orders,
        buildTestConfig({ AUTH_SERVICE_URL: 'http://auth:3001', INTERNAL_SERVICE_KEY: 'k'.repeat(16) }),
      );
    const entries = (mock: jest.SpyInstance) =>
      mock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

    let fetchMock: jest.SpyInstance;
    beforeEach(() => {
      fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    });
    afterEach(() => fetchMock.mockRestore());

    it('records the request and then the settlement of an approved refund', async () => {
      const svc = auditedService();
      const payment = await paidOver(150_000);
      await svc.refund(payment.id, 'finance', 'galon bocor');
      await svc.approveRefund(payment.id, 'hq');

      const logged = entries(fetchMock);
      expect(logged.map((e) => e.action)).toEqual([
        'payment.refund.requested',
        'payment.refund.settled',
      ]);
      expect(logged[0]).toMatchObject({
        actorId: 'finance',
        success: true,
        metadata: { amountIdr: 150_000, thresholdIdr: 100_000, reason: 'galon bocor' },
      });
      expect(logged[1]).toMatchObject({
        actorId: 'hq',
        metadata: { approval: RefundApproval.APPROVED, paymentId: payment.id },
      });
    });

    it('records a rejection as an unsuccessful decision, with who refused it', async () => {
      const svc = auditedService();
      const payment = await paidOver(150_000);
      await svc.refund(payment.id, 'finance');
      await svc.rejectRefund(payment.id, 'hq', 'tidak valid');

      const rejected = entries(fetchMock).find((e) => e.action === 'payment.refund.rejected');
      expect(rejected).toMatchObject({
        actorId: 'hq',
        success: false,
        metadata: { amountIdr: 150_000, reason: 'tidak valid' },
      });
    });

    it('records a below-threshold refund too — nobody approved it, and that is the record', async () => {
      const svc = auditedService();
      const payment = await paidOver(80_000);
      await svc.refund(payment.id, 'finance');

      const logged = entries(fetchMock);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        action: 'payment.refund.settled',
        metadata: { approval: RefundApproval.NONE },
      });
    });

    it('falls back to the payment id when there is no gateway reference', async () => {
      const svc = auditedService();
      // A cash payment never gets a reference — the trail still has to name the subject.
      const payment = await initiate(PaymentMethod.CASH);
      await svc.confirm(payment.id, 'kasir');
      await svc.refund(payment.id, '');

      const settled = entries(fetchMock).find((e) => e.action === 'payment.refund.settled');
      expect(settled.target).toBe(payment.id);
      // An empty actor is recorded as a system event, not as an actor named "".
      expect(settled.actorId).toBeUndefined();
    });

    it('records a rejection with no reason given', async () => {
      const svc = auditedService();
      const payment = await paidOver(150_000);
      await svc.refund(payment.id, 'finance'); // queued, no reason
      await svc.rejectRefund(payment.id, 'hq'); // rejected, no reason

      const rejected = entries(fetchMock).find((e) => e.action === 'payment.refund.rejected');
      expect(rejected.metadata.reason).toBeNull();
    });

    // Fail-open: the money already moved, so the trail must not be able to undo it.
    it('still settles the refund when the audit trail is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = auditedService();
      const payment = await paidOver(80_000);
      await expect(svc.refund(payment.id, 'finance')).resolves.toMatchObject({
        status: PaymentStatus.REFUNDED,
      });
    });
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

  /**
   * Signs a webhook the way a provider must (Q-15): every field except `signature`,
   * sorted by key, `k=v&k=v`. Built from the payload rather than a hand-written template
   * so a field added to the DTO is signed here too, instead of quietly going uncovered.
   */
  const signedWebhook = (
    fields: { reference: string; event: 'PAID' | 'FAILED'; timestamp?: number },
  ) => {
    const payload = { timestamp: Date.now(), ...fields };
    const canonical = Object.keys(payload)
      .sort()
      .map((k) => `${k}=${String((payload as Record<string, unknown>)[k])}`)
      .join('&');
    return {
      ...payload,
      signature: createHmac('sha256', WEBHOOK_SECRET).update(canonical).digest('hex'),
    };
  };

  it('settles a payment from a validly-signed webhook', async () => {
    const payment = await initiate(PaymentMethod.VA);
    const reference = payment.reference!;
    const result = await service.handleWebhook(signedWebhook({ reference, event: 'PAID' }));
    expect(result.handled).toBe(true);
    expect(repo.rows[0].status).toBe(PaymentStatus.PAID);
    // The PAID webhook confirms the order too.
    expect(orders.confirmedOrderIds).toEqual([payment.orderId]);
  });

  it('does not confirm the order when a webhook settles FAILED', async () => {
    const payment = await initiate(PaymentMethod.VA);
    const reference = payment.reference!;
    const result = await service.handleWebhook(signedWebhook({ reference, event: 'FAILED' }));
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
        timestamp: Date.now(),
        signature: 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  // Q-15: the old HMAC covered `${reference}.${event}` and nothing else, so a captured
  // PAID callback never went stale and any field the provider added later arrived
  // unauthenticated. Both halves are pinned here.
  it('rejects a replayed webhook whose signature is otherwise perfect', async () => {
    const payment = await initiate(PaymentMethod.VA);
    const stale = signedWebhook({
      reference: payment.reference!,
      event: 'PAID',
      timestamp: Date.now() - 6 * 60 * 1000, // one minute past the 5-minute window
    });
    await expect(service.handleWebhook(stale)).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
    expect(repo.rows[0].status).toBe(PaymentStatus.PENDING);
  });

  it('rejects a webhook whose timestamp was edited to look fresh', async () => {
    const payment = await initiate(PaymentMethod.VA);
    const captured = signedWebhook({
      reference: payment.reference!,
      event: 'PAID',
      timestamp: Date.now() - 6 * 60 * 1000,
    });
    // The timestamp is inside the HMAC, so refreshing it breaks the signature.
    await expect(
      service.handleWebhook({ ...captured, timestamp: Date.now() }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('ignores a webhook for an unknown reference (idempotent)', async () => {
    const result = await service.handleWebhook(signedWebhook({ reference: 'nope', event: 'PAID' }));
    expect(result.handled).toBe(false);
  });

  /*
   * K2.2 — a payment nobody completed has to stop being live eventually.
   *
   * There was no sweep and no cron line. The damage is not untidiness: `initiate` refuses
   * while an active (PENDING/PAID) payment exists, so one abandoned transfer locks its
   * order out of EVERY other method, permanently, with nothing saying why. Measured on
   * the live stack before this was written: 52 non-cash PENDING rows, oldest 26 July.
   */
  describe('expireStalePending (K2.2)', () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

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

    it('frees the order an abandoned transfer had locked out of every other method', async () => {
      const stale = await seedPending(PaymentMethod.TRANSFER, hoursAgo(30));
      // The lockout, stated before it is lifted: this is what the customer hit.
      await expect(
        service.initiate(customer, {
          orderId: stale.orderId,
          method: PaymentMethod.CASH,
          amount: 45000,
        }),
      ).rejects.toBeInstanceOf(PaymentAlreadyExistsError);

      expect(await service.expireStalePending(new Date())).toEqual({
        expired: 1,
        failed: 0,
        ok: true,
      });

      const retried = await service.initiate(customer, {
        orderId: stale.orderId,
        method: PaymentMethod.CASH,
        amount: 45000,
      });
      expect(retried.status).toBe(PaymentStatus.PENDING);
    });

    it('never touches CASH — a COD payment is PENDING until the courier confirms', async () => {
      await seedPending(PaymentMethod.CASH, hoursAgo(24 * 30));
      expect(await service.expireStalePending(new Date())).toEqual({
        expired: 0,
        failed: 0,
        ok: true,
      });
      expect(repo.rows[0].status).toBe(PaymentStatus.PENDING);
    });

    it('leaves a payment still inside its window alone', async () => {
      await seedPending(PaymentMethod.QRIS, hoursAgo(2));
      expect((await service.expireStalePending(new Date())).expired).toBe(0);
      expect(repo.rows[0].status).toBe(PaymentStatus.PENDING);
    });

    it('a TTL of zero is the kill switch: nothing expires, and that is a clean round', async () => {
      const svc = new PaymentService(
        repo,
        gateway,
        orders,
        buildTestConfig({ PAYMENT_PENDING_TTL_HOURS: '0' }),
      );
      await seedPending(PaymentMethod.QRIS, hoursAgo(24 * 30));
      expect(await svc.expireStalePending(new Date())).toEqual({ expired: 0, failed: 0, ok: true });
      expect(repo.rows[0].status).toBe(PaymentStatus.PENDING);
    });

    // The customer who pays in the same instant the sweep reaches their row must win.
    it('declines to overwrite a payment that was settled mid-sweep', async () => {
      const row = await seedPending(PaymentMethod.QRIS, hoursAgo(30));
      jest.spyOn(repo, 'findStalePending').mockImplementation(async () => {
        await repo.update(row.id, { status: PaymentStatus.PAID, paidAt: new Date() });
        return [{ ...row }];
      });
      expect(await service.expireStalePending(new Date())).toEqual({
        expired: 0,
        failed: 0,
        ok: true,
      });
      expect(repo.rows[0].status).toBe(PaymentStatus.PAID);
    });

    // J7: a round that could not expire anything must not read like a round with nothing
    // to expire — sweep.sh withholds the scheduler heartbeat on ok:false.
    it('reports ok:false when every row it found failed to move', async () => {
      await seedPending(PaymentMethod.QRIS, hoursAgo(30));
      jest.spyOn(repo, 'updateIfStatus').mockRejectedValue(new Error('db down'));
      expect(await service.expireStalePending(new Date())).toEqual({
        expired: 0,
        failed: 1,
        ok: false,
      });
    });

    it('stays ok when it expired something despite losing a row', async () => {
      await seedPending(PaymentMethod.QRIS, hoursAgo(31));
      await seedPending(PaymentMethod.TRANSFER, hoursAgo(30));
      const real = repo.updateIfStatus.bind(repo);
      let n = 0;
      jest.spyOn(repo, 'updateIfStatus').mockImplementation(async (...args) => {
        n += 1;
        if (n === 1) throw new Error('db down');
        return real(...args);
      });
      expect(await service.expireStalePending(new Date())).toEqual({
        expired: 1,
        failed: 1,
        ok: true,
      });
    });
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

      const out = await service.cashCollected([a, b]);
      expect(out.total).toBe(75000);
      expect(out.count).toBe(2);
    });

    // S2. The daily report shows a per-courier line, and the courier is on the order — so
    // the same read has to come back split, not just summed. Same book, same moment: two
    // reads could disagree, and then the column total would not match its own rows.
    it('splits the same cash per order, and the split adds up to the total', async () => {
      const a = await settleCash(45000);
      const b = await settleCash(30000);
      const unpaid = randomUUID();
      await initiate(PaymentMethod.CASH, 99000, unpaid); // stays PENDING

      const out = await service.cashCollected([a, b, unpaid]);
      expect(out.total).toBe(75000);
      expect(out.count).toBe(2);
      expect(out.byOrder).toEqual(
        expect.arrayContaining([
          { orderId: a, amountIdr: 45000 },
          { orderId: b, amountIdr: 30000 },
        ]),
      );
      // The unpaid order is absent, not a zero row — "nobody paid yet" is not "paid nothing".
      expect(out.byOrder.map((r) => r.orderId)).not.toContain(unpaid);
      expect(out.byOrder.reduce((s, r) => s + r.amountIdr, 0)).toBe(out.total);
    });

    it('returns an empty split for an empty order set', async () => {
      expect(await service.cashCollected([])).toEqual({ total: 0, count: 0, byOrder: [] });
    });

    it('ignores unpaid cash and non-cash methods', async () => {
      const pendingCash = randomUUID();
      await initiate(PaymentMethod.CASH, 45000, pendingCash); // stays PENDING
      const va = await initiate(PaymentMethod.VA, 45000);
      await service.confirm(va.id, customer); // PAID but not cash

      expect(await service.cashCollected([pendingCash, va.orderId])).toEqual({
        total: 0,
        count: 0,
        byOrder: [],
      });
    });
  });

  /*
   * K2.3 — the cancellation counterpart of voidForOrder, and deliberately NOT the same
   * call. A counter void settles straight to REFUNDED because a cashier is handing cash
   * across the counter there and then; a delivery cancellation has no till, so it goes
   * through `refund` and the HQ approval threshold applies exactly as it does elsewhere.
   */
  describe('cancelForOrder (K2.3)', () => {
    it('fails an unsettled payment, so it stops blocking its own order', async () => {
      const orderId = randomUUID();
      await initiate(PaymentMethod.TRANSFER, 45000, orderId);

      const settled = await service.cancelForOrder(orderId, 'Dibatalkan pelanggan', 'order-service');

      expect(settled?.status).toBe(PaymentStatus.FAILED);
      expect(settled?.refundedAmount).toBeNull();
      // The whole point: the order can be paid again.
      await expect(initiate(PaymentMethod.CASH, 45000, orderId)).resolves.toMatchObject({
        status: PaymentStatus.PENDING,
      });
    });

    it('refunds a settled one through the normal path, approval threshold and all', async () => {
      const orderId = randomUUID();
      const payment = await initiate(PaymentMethod.CASH, 45000, orderId);
      await service.confirm(payment.id, 'cashier-1', 50000);

      const settled = await service.cancelForOrder(orderId, 'Dibatalkan', 'order-service');

      expect(settled?.refundedAmount).toBe(45000);
      // Under the threshold here, so it settles — but through `refund`, which is what makes
      // a high-value one park for HQ instead of moving money unattended.
      expect(settled?.status).toBe(PaymentStatus.REFUNDED);
    });

    it('reports null when the order never had an active payment', async () => {
      expect(await service.cancelForOrder(randomUUID(), 'Batal', 'order-service')).toBeNull();
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
