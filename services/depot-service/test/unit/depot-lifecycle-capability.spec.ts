import { Reflector } from '@nestjs/core';
import { CAPABILITY_KEY } from '@hydromart/platform';
import { can } from '@hydromart/access';

import { DepotController } from '../../src/modules/depot.controller';

/*
 * Owner decision 2026-10-15: opening and closing a depot is head office's, editing the depot
 * you run stays the manager's. The franchise "Setujui & provision" flow ended in
 * `POST /depots`, which only MANAGER and SUPER_ADMIN held — so HEAD_OFFICE and DIREKTUR, who
 * approve the application, got a 403 on the provisioning step.
 */
describe('depot lifecycle is its own capability', () => {
  const reflector = new Reflector();
  const capabilityOf = (method: keyof DepotController) =>
    reflector.get<string>(CAPABILITY_KEY, DepotController.prototype[method] as never);

  it('gates create and deactivate on depotLifecycle', () => {
    expect(capabilityOf('create')).toBe('depotLifecycle');
    expect(capabilityOf('remove')).toBe('depotLifecycle');
  });

  it('leaves editing and the QRIS upload with the depot manager', () => {
    expect(capabilityOf('update')).toBe('depotAdmin');
    expect(capabilityOf('uploadQris')).toBe('depotAdmin');
  });

  it('serves head office and the director, and no longer the depot manager', () => {
    for (const role of ['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN']) {
      expect(can('depotLifecycle', role)).toBe(true);
    }
    expect(can('depotLifecycle', 'MANAGER')).toBe(false);
  });
});
