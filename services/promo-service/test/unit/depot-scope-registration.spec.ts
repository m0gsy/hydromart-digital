import { APP_GUARD } from '@nestjs/core';

import { DepotScopeGuard, JwtAuthGuard, RolesGuard } from '@hydromart/platform';

import { providers } from '../../src/modules/promo.module';

// B-14: promo-service exposed `depots/:depotId/voucher-requests` and passed the path
// parameter straight into the service, but never registered DepotScopeGuard — so depot
// scoping on vouchers and promotions was enforced by a guard the service does not install.
//
// CA-2-42 removed that route (the owner chose to let depots create their own vouchers
// rather than queue them for HQ). The guard stays and so does this test: it is a
// module-wide APP_GUARD, promo-service will grow another depot-scoped path, and taking it
// out now means the next one arrives unguarded — which is how B-14 happened.
// Twelve other services register it; promo-service was the only outlier with depot-scoped
// routes.
//
// Asserting on the providers array (rather than booting the module) keeps this a unit test
// and still fails against the old code, because the guard was simply absent from the list.

function guardClasses(): unknown[] {
  return (providers as { provide?: unknown; useClass?: unknown }[])
    .filter((p) => p?.provide === APP_GUARD)
    .map((p) => p.useClass);
}

describe('promo-service global guards', () => {
  it('registers DepotScopeGuard — depot-scoped routes are otherwise unguarded', () => {
    expect(guardClasses()).toContain(DepotScopeGuard);
  });

  it('still registers the auth and role guards', () => {
    expect(guardClasses()).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('keeps JwtAuthGuard ahead of the guards that read req.user', () => {
    const order = guardClasses();
    expect(order.indexOf(JwtAuthGuard)).toBeLessThan(order.indexOf(RolesGuard));
    expect(order.indexOf(JwtAuthGuard)).toBeLessThan(order.indexOf(DepotScopeGuard));
  });
});
