import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@hydromart/platform';

import { ProfileController } from '../../src/modules/profile.controller';

/*
 * K5.1 — `/profile/notifications` has no role guard at all.
 *
 * It writes `user.sub` into the CUSTOMER preference table, so a courier or an operator
 * toggling a switch in the driver app minted a customer-preference row keyed by a staff
 * account id — rows nothing reads (staff pushes deliberately ignore customer mutes, F8) in
 * a table that is meant to hold one audience. A switch that moves a row and changes nothing
 * is the shape this repo has fixed twice already; the missing guard is the defect underneath.
 *
 * Not a duplicate of F1: F1 made the CUSTOMER toggle actually read. This is about who is
 * allowed to write it at all.
 */
describe('K5.1 · notification preferences belong to customers', () => {
  const reflector = new Reflector();
  const rolesOf = (method: keyof ProfileController) =>
    reflector.get<string[]>(ROLES_KEY, ProfileController.prototype[method] as never);

  it('gates both preference routes on CUSTOMER', () => {
    expect(rolesOf('getNotifications')).toEqual(['CUSTOMER']);
    expect(rolesOf('updateNotifications')).toEqual(['CUSTOMER']);
  });
});
