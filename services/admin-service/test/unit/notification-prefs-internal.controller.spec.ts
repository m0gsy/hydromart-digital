import { NotificationPrefsInternalController } from '../../src/modules/notification-prefs-internal.controller';

describe('NotificationPrefsInternalController', () => {
  it('hands the accounts and the toggle to the service and returns who switched push off', async () => {
    const pushDisabledFor = jest.fn().mockResolvedValue(['acc-1']);
    const controller = new NotificationPrefsInternalController({ pushDisabledFor } as never);
    await expect(
      controller.pushDisabled({ accountIds: ['acc-1', 'acc-2'], toggle: 'newOrder' }),
    ).resolves.toEqual({ disabled: ['acc-1'] });
    expect(pushDisabledFor).toHaveBeenCalledWith(['acc-1', 'acc-2'], 'newOrder');
  });
});
