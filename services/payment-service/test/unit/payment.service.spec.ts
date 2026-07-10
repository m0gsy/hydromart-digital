import { createHmac, randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import {
  GatewayUnavailableError,
  InvalidWebhookSignatureError,
  PaymentAlreadyExistsError,
  PaymentNotFoundError,
  PaymentNotRefundableError,
} from '../../src/domain/errors';
import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import {
  FakeGateway,
  InMemoryPaymentRepository,
  WEBHOOK_SECRET,
  buildTestConfig,
} from '../support/fakes';

describe('PaymentService', () => {
  let repo: InMemoryPaymentRepository;
  let gateway: FakeGateway;
  let service: PaymentService;
  const customer = randomUUID();

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    gateway = new FakeGateway();
    service = new PaymentService(repo, gateway, buildTestConfig());
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
    const payment = await initiate(PaymentMethod.QRIS);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.reference).toMatch(/^REF-/);
    expect(gateway.charges).toHaveLength(1);
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
  });

  it('refunds a paid online payment via the gateway (BR: online-paid cancel needs refund)', async () => {
    const payment = await initiate(PaymentMethod.QRIS);
    await service.confirm(payment.id, 'staff');
    const refunded = await service.refund(payment.id, 'finance', 'order cancelled');
    expect(refunded.status).toBe(PaymentStatus.REFUNDED);
    expect(refunded.refundedAmount).toBe(45000);
    expect(refunded.refundReason).toBe('order cancelled');
  });

  it('refuses to refund a payment that is not PAID', async () => {
    const payment = await initiate(PaymentMethod.CASH);
    await expect(service.refund(payment.id, 'finance')).rejects.toBeInstanceOf(
      PaymentNotRefundableError,
    );
  });

  it("never reveals another customer's payment (cross-tenant 404)", async () => {
    const payment = await initiate(PaymentMethod.CASH);
    await expect(service.getForCustomer(randomUUID(), payment.id)).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('settles a payment from a validly-signed webhook', async () => {
    const payment = await initiate(PaymentMethod.QRIS);
    const reference = payment.reference!;
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${reference}.PAID`)
      .digest('hex');
    const result = await service.handleWebhook({ reference, event: 'PAID', signature });
    expect(result.handled).toBe(true);
    expect(repo.rows[0].status).toBe(PaymentStatus.PAID);
  });

  it('rejects a webhook with a bad signature', async () => {
    const payment = await initiate(PaymentMethod.QRIS);
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
