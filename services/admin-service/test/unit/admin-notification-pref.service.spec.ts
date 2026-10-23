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
    expect(prefs.channels.map((c) => c.id).slice(0, 5)).toEqual([
      'criticalSla',
      'newFranchiseApp',
      'payoutPending',
      'systemIncident',
      'dailyDigest',
    ]);
    expect(prefs.channels.find((c) => c.id === 'dailyDigest')).toMatchObject({
      push: false,
      email: true,
    });
  });

  it('persists a saved channel change and reads it back', async () => {
    await service.save('acc-1', [{ id: 'criticalSla', push: false, email: false, wa: true }]);
    const prefs = await service.get('acc-1');
    expect(prefs.channels.find((c) => c.id === 'criticalSla')).toMatchObject({
      push: false,
      email: false,
      wa: true,
    });
    // Unset events still fall back to defaults.
    expect(prefs.channels.find((c) => c.id === 'systemIncident')).toMatchObject({
      push: true,
      email: true,
      wa: true,
    });
  });

  it('drops unknown event ids on save', async () => {
    await service.save('acc-1', [{ id: 'bogus', push: true, email: true, wa: true }]);
    const prefs = await service.get('acc-1');
    expect(prefs.channels.some((c) => c.id === 'bogus')).toBe(false);
    expect(prefs.channels).toHaveLength(10);
  });

  it('serves the depot event list in DEPOT scope, with its own defaults', async () => {
    const prefs = await service.get('acc-1', 'DEPOT');
    expect(prefs.channels.map((c) => c.id)).toEqual([
      'newOrder',
      'lowStock',
      'courierFail',
      'approval',
      'dailySummary',
    ]);
    // An operator is on the floor, not in an inbox.
    expect(prefs.channels.find((c) => c.id === 'newOrder')).toMatchObject({
      push: true,
      email: false,
      wa: false,
    });
    // The sales updates and the morning recap are on unless somebody opts out.
    expect(prefs.channels.find((c) => c.id === 'dailySummary')).toMatchObject({
      push: true,
      email: false,
      wa: false,
    });
  });

  it('serves both lists in ALL scope', async () => {
    const prefs = await service.get('acc-1', 'ALL');
    expect(prefs.channels).toHaveLength(10);
  });

  /*
   * The reason save is a merge and not a replace: the depot screens post three ids, and a
   * blind replace would delete the HQ prefs of anybody holding both lists.
   */
  it('a depot save leaves the same account HQ prefs untouched', async () => {
    await service.save(
      'acc-1',
      [{ id: 'criticalSla', push: false, email: false, wa: false }],
      'ALL',
    );
    await service.save('acc-1', [{ id: 'newOrder', push: false, email: true, wa: false }], 'DEPOT');

    const hq = await service.get('acc-1', 'ALL');
    expect(hq.channels.find((c) => c.id === 'criticalSla')).toMatchObject({
      push: false,
      email: false,
      wa: false,
    });
    const depot = await service.get('acc-1', 'DEPOT');
    expect(depot.channels.find((c) => c.id === 'newOrder')).toMatchObject({
      push: false,
      email: true,
      wa: false,
    });
  });

  it('a DEPOT save cannot write an HQ event', async () => {
    await service.save(
      'acc-1',
      [{ id: 'criticalSla', push: false, email: false, wa: false }],
      'DEPOT',
    );
    const all = await service.get('acc-1');
    expect(all.channels.find((c) => c.id === 'criticalSla')).toMatchObject({ push: true });
  });

  it('keeps prefs isolated per account', async () => {
    await service.save('acc-1', [{ id: 'criticalSla', push: false, email: false, wa: false }]);
    const other = await service.get('acc-2');
    expect(other.channels.find((c) => c.id === 'criticalSla')).toMatchObject({
      push: true,
      email: true,
    });
  });

  describe('pushDisabledFor', () => {
    const off = { push: false, email: false, wa: false };

    it('names the accounts that switched push off for the toggle', async () => {
      await service.save('acc-1', [{ id: 'newOrder', ...off }], 'DEPOT');
      await service.save('acc-2', [{ id: 'newOrder', push: true, email: false, wa: false }], 'DEPOT');
      expect(await service.pushDisabledFor(['acc-1', 'acc-2', 'acc-3'], 'newOrder')).toEqual(['acc-1']);
    });

    it('treats an account that never saved anything as the toggle default, not as off', async () => {
      // Every depot toggle defaults to push ON, the daily summary included.
      expect(await service.pushDisabledFor(['acc-9'], 'newOrder')).toEqual([]);
      expect(await service.pushDisabledFor(['acc-9'], 'dailySummary')).toEqual([]);
    });

    it('a saved row for another toggle does not change this one', async () => {
      await service.save('acc-1', [{ id: 'lowStock', ...off }], 'DEPOT');
      expect(await service.pushDisabledFor(['acc-1'], 'newOrder')).toEqual([]);
      expect(await service.pushDisabledFor(['acc-1'], 'lowStock')).toEqual(['acc-1']);
    });

    it('answers nothing for a toggle that is not a depot alert', async () => {
      await service.save('acc-1', [{ id: 'criticalSla', ...off }]);
      expect(await service.pushDisabledFor(['acc-1'], 'criticalSla')).toEqual([]);
      expect(await service.pushDisabledFor(['acc-1'], 'nonsense')).toEqual([]);
    });

    it('asks for no accounts without touching the store', async () => {
      const spy = jest.spyOn(repo, 'getMany');
      expect(await service.pushDisabledFor([], 'newOrder')).toEqual([]);
      expect(spy).toHaveBeenCalledWith([]);
    });
  });
});
