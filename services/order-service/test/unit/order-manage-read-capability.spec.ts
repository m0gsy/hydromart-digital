import { Reflector } from '@nestjs/core';
import { CAPABILITY_KEY } from '@hydromart/platform';
import { can } from '@hydromart/access';

import { OrderController } from '../../src/modules/order.controller';

/*
 * 2026-10-15 — FINANCE holds `refundIssue` and the payment-recon screen, and could open
 * neither an order nor the recon list: both reads were `orderQueue`, which also gates
 * assigning and MOVING an order between depots.
 *
 * The read got its own capability. The moves stay where they were.
 */
describe('reading the staff order list is not moving an order', () => {
  const reflector = new Reflector();
  const capabilityOf = (method: keyof OrderController) =>
    reflector.get<string>(CAPABILITY_KEY, OrderController.prototype[method] as never);

  it('gates the list and the detail on the read capability', () => {
    expect(capabilityOf('listManaged')).toBe('orderManageRead');
    expect(capabilityOf('getManaged')).toBe('orderManageRead');
  });

  it('keeps assign and move on the queue capability', () => {
    expect(capabilityOf('assignDepot')).toBe('orderQueue');
    expect(capabilityOf('rerouteDepot')).toBe('orderQueue');
  });

  it('lets FINANCE read, and gives it no way to move', () => {
    expect(can('orderManageRead', 'FINANCE')).toBe(true);
    expect(can('orderQueue', 'FINANCE')).toBe(false);
  });

  it('does not take the read away from anyone who had it', () => {
    for (const role of ['KEPALA_DEPOT', 'MANAGER', 'STAFF_DEPOT', 'SUPERVISOR', 'HEAD_OFFICE', 'DIREKTUR']) {
      expect(can('orderManageRead', role)).toBe(true);
    }
  });
});
