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

  it('gives the TRANSFER offline instruction and no gateway call', async () => {
    const payment = await initiate(PaymentMethod.TRANSFER);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.reference).toBeNull();
    expect(payment.instruction).toContain('Transfer');
    expect(gateway.charges).toHaveLength(0);
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
    expect(byMethod[PaymentMethod.VA]).toEqual({ method: PaymentMethod.VA, amount: 99_000, count: 1 });
    expect(byMethod[PaymentMethod.CASH]).toEqual({ method: PaymentMethod.CASH, amount: 10_000, count: 1 });
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
