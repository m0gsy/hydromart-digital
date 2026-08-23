import { Reflector } from '@nestjs/core';
import { CAPABILITY_KEY } from '@hydromart/platform';
import { can } from '@hydromart/access';

import { PaymentController } from '../../src/modules/payment.controller';

/*
 * J9 — two roles may DISPATCH an order and may not SEE its money.
 *
 * `orderQueue` includes SUPERVISOR and ASSISTANT_SUPERVISOR, so both open the staff order
 * detail. The payment panel on that screen reads `for-order/:orderId`, which is gated on
 * `paymentSettle` — the capability to CHANGE a payment. So the queue is handed over and
 * the panel inside it 403s, on every order, for exactly the roles whose job is dispatch.
 * delivery-service already documents this collision in a comment and works around it with
 * an internal key.
 *
 * Reading is not settling: the read gets its own capability, wide enough for everyone the
 * order screen already admits, and every mutation stays exactly where it was.
 */
describe('J9 · reading an order payment is not settling it', () => {
  const reflector = new Reflector();
  const capabilityOf = (method: keyof PaymentController) =>
    reflector.get<string>(CAPABILITY_KEY, PaymentController.prototype[method] as never);

  it('gates the staff read on a read capability', () => {
    expect(capabilityOf('listForOrder')).toBe('paymentRead');
  });

  it('admits the dispatch roles to the read', () => {
    for (const role of ['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'DIREKTUR']) {
      expect(can('paymentRead', role)).toBe(true);
    }
  });

  it('keeps everyone who could already read it', () => {
    for (const role of ['KEPALA_DEPOT', 'MANAGER', 'STAFF_DEPOT', 'FINANCE']) {
      expect(can('paymentRead', role)).toBe(true);
    }
  });

  it('gives none of them the power to settle', () => {
    for (const role of ['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'DIREKTUR']) {
      expect(can('paymentSettle', role)).toBe(false);
    }
    expect(capabilityOf('confirm')).toBe('paymentSettle');
  });
});
