import { AuthenticatedUser } from '@hydromart/platform';

import { DriverSettingsController } from '../../src/modules/driver-settings.controller';
import { DeliveryConfigService } from '../../src/config/delivery-config.service';

/**
 * CA-4-29 and CA-4-37 — the courier app read its tuned numbers from `settings/schema`,
 * which is gated on `settingsRead`: MANAGER, HEAD_OFFICE, DIREKTUR, FINANCE, SUPER_ADMIN.
 * A courier is none of them, so the route screen's ETA summary 403'd on every load and had
 * never once appeared for the person the screen is for. The no-show screen did not even
 * try — it hard-coded the attempt threshold at 2 against a per-depot setting.
 *
 * Two things this pins, because both were the reason not to just widen `settingsRead`:
 * the response carries ONLY the values the courier app renders — never the whole tunable
 * schema, money among it — and the depot comes off the token rather than a query parameter.
 *
 * Now seven, not four. `maxActiveDeliveriesPerDriver` was the same defect as
 * `noShowMinContactAttempts` and outlived its own fix: the server has had a per-depot cap
 * all along, read on every assign, and the courier app hard-coded 1 — so a depot that
 * raised the cap saw the app go on refusing a second delivery for a reason it could not
 * show. The two self-claim numbers are here because the screen has to know whether the
 * button exists at all, and how long the wait is before it does anything.
 */
describe('DriverSettingsController (CA-4-29, CA-4-37)', () => {
  const config = {
    urbanSpeedKmph: jest.fn().mockReturnValue(18),
    routeStopMinutes: jest.fn().mockReturnValue(4),
    noShowMinContactAttempts: jest.fn().mockReturnValue(3),
    noShowMinWaitSeconds: jest.fn().mockReturnValue(300),
    maxActiveDeliveriesPerDriver: jest.fn().mockReturnValue(2),
    courierSelfClaimEnabled: jest.fn().mockReturnValue(1),
    courierSelfClaimWaitMinutes: jest.fn().mockReturnValue(10),
  };
  const controller = new DriverSettingsController(config as unknown as DeliveryConfigService);
  afterEach(() => jest.clearAllMocks());

  it("answers the courier's own depot values, read from the token", () => {
    const user = { sub: 'c1', depotId: 'depot-7' } as AuthenticatedUser;
    expect(controller.read(user)).toEqual({
      urbanSpeedKmph: 18,
      routeStopMinutes: 4,
      noShowMinContactAttempts: 3,
      noShowMinWaitSeconds: 300,
      maxActiveDeliveriesPerDriver: 2,
      courierSelfClaimEnabled: 1,
      courierSelfClaimWaitMinutes: 10,
    });
    for (const fn of Object.values(config)) {
      expect(fn).toHaveBeenCalledWith('depot-7');
    }
  });

  it('falls back to the GLOBAL value when the token carries no depot', () => {
    controller.read({ sub: 'c1' } as AuthenticatedUser);
    for (const fn of Object.values(config)) {
      expect(fn).toHaveBeenCalledWith(null);
    }
  });

  it('returns nothing beyond the values the courier app renders', () => {
    // The reason this route exists rather than widening `settingsRead`: that schema carries
    // every tunable this service has, money among them. This list may grow; it may not grow
    // into anything the courier does not render.
    expect(Object.keys(controller.read({ sub: 'c1' } as AuthenticatedUser)).sort()).toEqual([
      'courierSelfClaimEnabled',
      'courierSelfClaimWaitMinutes',
      'maxActiveDeliveriesPerDriver',
      'noShowMinContactAttempts',
      'noShowMinWaitSeconds',
      'routeStopMinutes',
      'urbanSpeedKmph',
    ]);
  });
});
