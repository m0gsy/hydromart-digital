import { createHmac, randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import {
  GatewayUnavailableError,
  InvalidWebhookSignatureError,
  PaymentAlreadyExistsError,
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
});
