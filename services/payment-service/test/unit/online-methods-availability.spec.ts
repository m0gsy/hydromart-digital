import { randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import { GatewayUnavailableError } from '../../src/domain/errors';
import { PaymentMethod } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  buildTestConfig,
} from '../support/fakes';

/*
 * O5 — e-wallet and virtual account are the only methods that go through a gateway, and
 * `PAYMENT_GATEWAY_BASE_URL` is empty in production. Both are therefore buttons that CANNOT
 * succeed: the adapter throws "Payment gateway is not configured" and the customer meets a
 * failure after choosing how to pay.
 *
 * Two halves. The server half is here: the refusal used to happen only after a payment row
 * had been created, so every attempt left a FAILED row on the order — noise in the ledger
 * for a method nobody could have used. And nothing anywhere could ANSWER "which methods can
 * this deployment actually take", which is what the screen needs in order not to offer them.
 */
describe('O5 · a method with no gateway is refused before it costs a row', () => {
  const customer = randomUUID();
  const build = (gatewayConfigured: boolean) => {
    const repo = new InMemoryPaymentRepository();
    const gateway = new FakeGateway();
    gateway.configured = gatewayConfigured;
    const service = new PaymentService(
      repo,
      gateway,
      new FakeOrderCoordination(),
      buildTestConfig(),
    );
    return { repo, gateway, service };
  };

  for (const method of [PaymentMethod.EWALLET, PaymentMethod.VA]) {
    it(`refuses ${method} with no gateway configured, and writes no payment`, async () => {
      const { repo, gateway, service } = build(false);
      await expect(
        service.initiate(customer, { orderId: randomUUID(), method, amount: 45000 }),
      ).rejects.toBeInstanceOf(GatewayUnavailableError);
      expect(repo.rows).toHaveLength(0);
      expect(gateway.charges).toHaveLength(0);
    });
  }

  it('still takes the methods the depot settles by hand', async () => {
    const { repo, service } = build(false);
    for (const method of [PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.QRIS]) {
      await service.initiate(customer, { orderId: randomUUID(), method, amount: 45000 });
    }
    expect(repo.rows).toHaveLength(3);
  });

  it('says which methods are available, so the screen can stop offering the others', () => {
    expect(build(false).service.availableMethods()).toEqual({
      CASH: true,
      TRANSFER: true,
      QRIS: true,
      EWALLET: false,
      VA: false,
    });
    expect(build(true).service.availableMethods()).toMatchObject({
      EWALLET: true,
      VA: true,
    });
  });

  it('lets a configured gateway through exactly as before', async () => {
    const { repo, gateway, service } = build(true);
    await service.initiate(customer, {
      orderId: randomUUID(),
      method: PaymentMethod.VA,
      amount: 45000,
    });
    expect(gateway.charges).toHaveLength(1);
    expect(repo.rows).toHaveLength(1);
  });
});
