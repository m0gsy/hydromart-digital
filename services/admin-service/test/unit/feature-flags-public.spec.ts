import { FlagState } from '../../src/domain/flag-state';
import { FeatureFlagsController } from '../../src/modules/feature-flags.controller';

const flag = (key: string, state: FlagState) => ({
  id: key,
  key,
  label: key,
  description: '',
  state,
  rolloutPct: null,
  updatedAt: new Date(),
});

describe('FeatureFlagsController.publicFlags', () => {
  it('publishes only enforced keys, as on/off', async () => {
    const list = jest
      .fn()
      .mockResolvedValue([
        flag('payments.cash_on_delivery', FlagState.OFF),
        flag('subscriptions.galon', FlagState.BETA),
        flag('recommendations.ai', FlagState.ROLLOUT),
        flag('attendance.courier_one_tap', FlagState.OFF),
        flag('notifications.leave_screen', FlagState.ACTIVE),
        flag('some.unreleased', FlagState.OFF),
      ]);
    const controller = new FeatureFlagsController({ list } as never);

    expect(await controller.publicFlags()).toEqual([
      { key: 'payments.cash_on_delivery', enabled: false },
      { key: 'subscriptions.galon', enabled: true },
      { key: 'recommendations.ai', enabled: true },
      // The brake: published like the others, so turning it OFF reaches every installed app.
      { key: 'attendance.courier_one_tap', enabled: false },
      // Flow 6a: crm reads it from here, fail-closed.
      { key: 'notifications.leave_screen', enabled: true },
    ]);
  });

  it.each([
    [FlagState.ACTIVE, true],
    [FlagState.ROLLOUT, false],
    [FlagState.BETA, false],
    [FlagState.OFF, false],
  ])('publishes the one-tap brake as enabled only while ACTIVE (%s → %s)', async (state, enabled) => {
    const list = jest.fn().mockResolvedValue([flag('attendance.courier_one_tap', state)]);
    const controller = new FeatureFlagsController({ list } as never);
    expect(await controller.publicFlags()).toEqual([{ key: 'attendance.courier_one_tap', enabled }]);
  });

  it.each([
    [FlagState.ACTIVE, true],
    [FlagState.ROLLOUT, false],
    [FlagState.BETA, false],
    [FlagState.OFF, false],
  ])('publishes the leave-screen brake as enabled only while ACTIVE (%s → %s)', async (state, enabled) => {
    const list = jest.fn().mockResolvedValue([flag('notifications.leave_screen', state)]);
    const controller = new FeatureFlagsController({ list } as never);
    expect(await controller.publicFlags()).toEqual([{ key: 'notifications.leave_screen', enabled }]);
  });
});
