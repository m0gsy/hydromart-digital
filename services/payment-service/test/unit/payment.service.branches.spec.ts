import { randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import {
  GatewayUnavailableError,
  InvalidPaymentTransitionError,
  PaymentNotFoundError,
  RefundNotPendingError,
} from '../../src/domain/errors';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  buildTestConfig,
} from '../support/fakes';

// Covers the branchier service paths not exercised by payment.service.spec.ts:
// fail(), revenueByMethod, invalid transitions, gateway-refund failure,
// reject-not-pending, the offline TRANSFER instruction and the list/search paths.
describe('PaymentService (branch coverage)', () => {
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

  it('marks a pending payment FAILED via fail()', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    const failed = await service.fail(payment.id, 'staff');
    expect(failed.status).toBe(PaymentStatus.FAILED);
    expect(failed.failedAt).not.toBeNull();
  });

  it('throws PaymentNotFoundError for an unknown id (getAny path)', async () => {
    await expect(service.confirm(randomUUID(), 'staff')).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('rejects an illegal status transition (confirm an already-FAILED payment)', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    await service.fail(payment.id, 'staff');
    await expect(service.confirm(payment.id, 'staff')).rejects.toBeInstanceOf(
      InvalidPaymentTransitionError,
    );
  });

  /*
   * The replay of a confirmation that already landed.
   *
   * COD confirmation rides the offline capture queue (K2.9), and the queue retries a job it
   * never got an answer for — including the answer lost AFTER the server wrote PAID. The
   * second attempt used to get "Cannot move a payment from PAID to PAID", a 409, which
   * `isRetryable` in offline-queue.ts correctly does not retry: the job was marked failed
   * and the courier was shown an error for cash that had been booked correctly. The app
   * lying about money is the failure the queue exists to prevent.
   */
  it('answers a replayed COD confirmation with the payment, not a conflict', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    const first = await service.confirm(payment.id, 'kurir', 50000);

    const replay = await service.confirm(payment.id, 'kurir', 50000);

    expect(replay.status).toBe(PaymentStatus.PAID);
    expect(replay.paidAt).toEqual(first.paidAt);
    expect(replay.cashReceived).toBe(first.cashReceived);
    expect(replay.changeGiven).toBe(first.changeGiven);
  });

  // A confirmation carrying no cash figure at all is a plain "is it paid" replay.
  it('answers a replay that carries no cash figure the same way', async () => {
    const payment = await initiate(PaymentMethod.TRANSFER);
    await service.confirm(payment.id, 'staff');
    await expect(service.confirm(payment.id, 'staff')).resolves.toMatchObject({
      status: PaymentStatus.PAID,
    });
  });

  /*
   * Not a replay. A second confirmation with a DIFFERENT figure is a cashier settling the
   * same order twice with different notes in hand — and the change owed to the customer was
   * computed from the first figure, so this must still conflict.
   */
  it('still conflicts when a second confirmation names different cash', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    await service.confirm(payment.id, 'kasir', 50000);
    await expect(service.confirm(payment.id, 'kasir', 100000)).rejects.toBeInstanceOf(
      InvalidPaymentTransitionError,
    );
  });

  it('gives the TRANSFER offline instruction and no gateway call', async () => {
    const payment = await initiate(PaymentMethod.TRANSFER);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.reference).toBeNull();
    expect(payment.instruction).toContain('Transfer');
    expect(gateway.charges).toHaveLength(0);
  });

  it('tells a counter buyer the cash is already on the till, not with a driver', async () => {
    const counter = await service.initiate(customer, {
      orderId: randomUUID(),
      method: PaymentMethod.CASH,
      amount: 45000,
      atCounter: true,
    });
    expect(counter.instruction).toBe('Cash paid at the depot counter.');

    // A delivery order keeps the courier wording.
    const delivered = await initiate(PaymentMethod.CASH);
    expect(delivered.instruction).toContain('driver');
  });

  it('fails closed when the gateway refund errors, leaving the payment PAID', async () => {
    const payment = await initiate(PaymentMethod.VA, 80_000);
    await service.confirm(payment.id, 'staff');
    gateway.throwOnRefund = true;
    await expect(service.refund(payment.id, 'finance')).rejects.toBeInstanceOf(
      GatewayUnavailableError,
    );
    // Not settled — the failed gateway call must not move the money.
    expect(repo.rows[0].status).toBe(PaymentStatus.PAID);
    expect(orders.refunded).toEqual([]);
  });

  it('rejects rejectRefund when the refund is not pending approval', async () => {
    const payment = await initiate(PaymentMethod.VA, 80_000);
    await service.confirm(payment.id, 'staff');
    await expect(service.rejectRefund(payment.id, 'hq', 'nope')).rejects.toBeInstanceOf(
      RefundNotPendingError,
    );
  });

  it('groups collected (PAID) revenue by method with amount + count', async () => {
    const va = await initiate(PaymentMethod.VA, 99_000);
    await service.confirm(va.id, 'staff');
    const cash = await initiate(PaymentMethod.CASH, 10_000);
    await service.confirm(cash.id, 'staff');
    // A still-pending payment is excluded from revenue.
    await initiate(PaymentMethod.CASH, 5_000);

    const rows = await service.revenueByMethod({});
    const byMethod = Object.fromEntries(rows.map((r) => [r.method, r]));
    expect(byMethod[PaymentMethod.VA]).toEqual({
      method: PaymentMethod.VA,
      amount: 99_000,
      count: 1,
    });
    expect(byMethod[PaymentMethod.CASH]).toEqual({
      method: PaymentMethod.CASH,
      amount: 10_000,
      count: 1,
    });
  });

  describe('listing (search paths)', () => {
    it('lists a customer’s own payments, scoped and filtered by status', async () => {
      const mine = await initiate(PaymentMethod.CASH, 10_000);
      await initiate(PaymentMethod.CASH, 20_000);
      // Another customer's payment must not appear.
      await service.initiate(randomUUID(), {
        orderId: randomUUID(),
        method: PaymentMethod.CASH,
        amount: 30_000,
      });

      const all = await service.listForCustomer(customer, {});
      expect(all.total).toBe(2);
      expect(all.items.every((p) => p.customerId === customer)).toBe(true);

      const paid = await service.listForCustomer(customer, { status: PaymentStatus.PAID });
      expect(paid.total).toBe(0);
      expect(mine.status).toBe(PaymentStatus.PENDING);
    });

    it('lists all payments across customers with clamped pagination', async () => {
      for (let i = 0; i < 3; i += 1) await initiate(PaymentMethod.CASH, 1_000 * (i + 1));
      // page/limit below 1 are clamped to sane bounds (page→1, limit→1).
      const page = await service.listAll({ page: 0, limit: 0 });
      expect(page.total).toBe(3);
      expect(page.page).toBe(1);
      expect(page.limit).toBe(1);
      expect(page.items.length).toBe(1);
    });
  });

  it('records the queued refund reason and keeps refundApproval PENDING', async () => {
    const payment = await initiate(PaymentMethod.VA, 150_000);
    await service.confirm(payment.id, 'staff');
    const queued = await service.refund(payment.id, 'finance', 'galon pecah');
    expect(queued.refundApproval).toBe(RefundApproval.PENDING);
    expect(queued.refundReason).toBe('galon pecah');
  });
});

/**
 * C2 · the counter payment names its drawer.
 *
 * The shift is resolved SERVER-side from the cashier's own bearer, never taken from the
 * body: a body that could name the shift could name somebody else's till, and this column
 * exists precisely so the cash is answerable to a named person.
 */
describe('PaymentService · C2 cashier shift', () => {
  const shiftPort = { openShiftId: jest.fn() };
  let repo: InMemoryPaymentRepository;
  let service: PaymentService;

  beforeEach(() => {
    shiftPort.openShiftId.mockReset().mockResolvedValue('shift-7');
    repo = new InMemoryPaymentRepository();
    service = new PaymentService(
      repo,
      new FakeGateway(),
      new FakeOrderCoordination(),
      buildTestConfig(),
      shiftPort as never,
    );
  });

  const counter = (over: Record<string, unknown> = {}) =>
    service.initiate('buyer-1', {
      orderId: randomUUID(),
      method: PaymentMethod.CASH,
      amount: 45000,
      atCounter: true,
      depotId: 'depot-1',
      authorization: 'Bearer cashier',
      ...over,
    });

  it('stamps the drawer the cashier has open', async () => {
    const payment = await counter();
    expect(shiftPort.openShiftId).toHaveBeenCalledWith('depot-1', 'Bearer cashier');
    expect(repo.rows.find((r) => r.id === payment.id)?.cashierShiftId).toBe('shift-7');
  });

  it('never asks for a delivery payment — there is no till', async () => {
    await service.initiate('buyer-1', {
      orderId: randomUUID(),
      method: PaymentMethod.CASH,
      amount: 45000,
      authorization: 'Bearer someone',
    });
    expect(shiftPort.openShiftId).not.toHaveBeenCalled();
  });

  it('leaves it unattributed when no shift is open, and still takes the payment', async () => {
    shiftPort.openShiftId.mockResolvedValue(null);
    const payment = await counter();
    expect(repo.rows.find((r) => r.id === payment.id)?.cashierShiftId ?? null).toBeNull();
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it('leaves it unattributed when there is no token to ask with', async () => {
    await counter({ authorization: undefined });
    expect(shiftPort.openShiftId).not.toHaveBeenCalled();
  });
});
