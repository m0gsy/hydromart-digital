import { NotificationPrefsInternalController } from '../../src/modules/notification-prefs-internal.controller';

describe('NotificationPrefsInternalController', () => {
  it('hands the accounts and the toggle to the service and returns who switched push off', async () => {
    const pushDisabledFor = jest.fn().mockResolvedValue(['acc-1']);
    const controller = new NotificationPrefsInternalController({ pushDisabledFor } as never, {} as never);
    await expect(
      controller.pushDisabled({ accountIds: ['acc-1', 'acc-2'], toggle: 'newOrder' }),
    ).resolves.toEqual({ disabled: ['acc-1'] });
    expect(pushDisabledFor).toHaveBeenCalledWith(['acc-1', 'acc-2'], 'newOrder');
  });

  it("hands crm's email to the email channel and answers its counts", async () => {
    const send = jest.fn().mockResolvedValue({ sent: 1, failed: 0, skipped: 1 });
    const controller = new NotificationPrefsInternalController({} as never, { send } as never);
    const dto = {
      accountIds: ['acc-1', 'acc-2'],
      toggle: 'newFranchiseApp',
      subject: 'Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat',
      text: 'Lamaran waralaba baru dari calon mitra di Bekasi, Jawa Barat.',
      path: '/hq/applications/detail?id=a',
    };
    await expect(controller.emailStaff(dto)).resolves.toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(send).toHaveBeenCalledWith(dto);
  });
});
