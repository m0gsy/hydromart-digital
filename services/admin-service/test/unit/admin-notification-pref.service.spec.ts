import { AdminNotificationPrefService } from '../../src/application/services/admin-notification-pref.service';
import { InMemoryAdminNotificationPrefRepository } from '../support/fakes';

describe('AdminNotificationPrefService', () => {
  let repo: InMemoryAdminNotificationPrefRepository;
  let service: AdminNotificationPrefService;

  beforeEach(() => {
    repo = new InMemoryAdminNotificationPrefRepository();
    service = new AdminNotificationPrefService(repo);
  });

  it('returns the canonical event list with defaults when unset', async () => {
    const prefs = await service.get('acc-1');
    expect(prefs.channels.map((c) => c.id)).toEqual([
      'criticalSla',
      'newFranchiseApp',
      'payoutPending',
      'systemIncident',
      'dailyDigest',
    ]);
    expect(prefs.channels.find((c) => c.id === 'dailyDigest')).toMatchObject({ push: false, email: true });
  });

  it('persists a saved channel change and reads it back', async () => {
    await service.save('acc-1', [{ id: 'criticalSla', push: false, email: false, wa: true }]);
    const prefs = await service.get('acc-1');
    expect(prefs.channels.find((c) => c.id === 'criticalSla')).toMatchObject({ push: false, email: false, wa: true });
    // Unset events still fall back to defaults.
    expect(prefs.channels.find((c) => c.id === 'systemIncident')).toMatchObject({ push: true, email: true, wa: true });
  });

  it('drops unknown event ids on save', async () => {
    await service.save('acc-1', [{ id: 'bogus', push: true, email: true, wa: true }]);
    const prefs = await service.get('acc-1');
    expect(prefs.channels.some((c) => c.id === 'bogus')).toBe(false);
    expect(prefs.channels).toHaveLength(5);
  });

  it('keeps prefs isolated per account', async () => {
    await service.save('acc-1', [{ id: 'criticalSla', push: false, email: false, wa: false }]);
    const other = await service.get('acc-2');
    expect(other.channels.find((c) => c.id === 'criticalSla')).toMatchObject({ push: true, email: true });
  });
});
