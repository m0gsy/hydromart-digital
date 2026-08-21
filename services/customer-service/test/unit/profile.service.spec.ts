import { ProfileService } from '../../src/application/services/profile.service';
import { NotificationService } from '../../src/application/services/notification.service';
import { MembershipTier } from '../../src/domain/membership-tier.enum';
import type { DepotLedgerPort } from '../../src/application/ports/depot-ledger.port';
import {
  buildTestConfig,
  FakeLoyaltyReward,
  InMemoryNotificationRepository,
  InMemoryProfileRepository,
} from '../support/fakes';

/**
 * I5: the profile now reads the depot deposit ledger. It defaults to `null` — "not known" —
 * which is the honest answer when depot-service is unreachable, and the one the screen
 * renders as "belum tersambung" rather than as a zero nobody checked.
 */
const ledger = (rows: unknown = null): DepotLedgerPort =>
  ({ depositsForCustomer: async () => rows }) as unknown as DepotLedgerPort;

describe('ProfileService', () => {
  let repo: InMemoryProfileRepository;
  let loyalty: FakeLoyaltyReward;
  let service: ProfileService;

  beforeEach(() => {
    repo = new InMemoryProfileRepository();
    loyalty = new FakeLoyaltyReward();
    service = new ProfileService(repo, loyalty, ledger(), buildTestConfig());
  });

  it('lazily creates a default BASIC profile on first read', async () => {
    const p = await service.get('cust-1');
    expect(p.membershipTier).toBe(MembershipTier.BASIC);
    expect(p.pointBalance).toBe(0);
    expect(p.favoriteDepotId).toBeNull();
    expect(p.birthdate).toBeNull();
  });

  it('sets the favorite depot', async () => {
    const p = await service.setFavoriteDepot('cust-1', 'depot-9');
    expect(p.favoriteDepotId).toBe('depot-9');
    const cleared = await service.setFavoriteDepot('cust-1', null);
    expect(cleared.favoriteDepotId).toBeNull();
  });

  it('sets and clears the birthdate', async () => {
    const p = await service.setBirthdate('cust-1', new Date('1990-05-17'));
    expect(p.birthdate?.toISOString().slice(0, 10)).toBe('1990-05-17');
    const cleared = await service.setBirthdate('cust-1', null);
    expect(cleared.birthdate).toBeNull();
  });
});

/**
 * I5: the customer's own deposit, read straight through from depot-service.
 *
 * `null` must survive the trip. Flattening it to `[]` anywhere on the way would tell the
 * customer they are holding nothing and owed nothing — and that is somebody's money.
 */
describe('ProfileService.myGallonDeposits (I5)', () => {
  const rows = [
    { depotId: 'd1', depotName: 'Depot Cikini', gallonsOnLoan: 2, depositHeldIdr: 40000 },
  ];

  it('hands back what the depot ledger answered, for the caller only', async () => {
    const svc = new ProfileService(
      new InMemoryProfileRepository(),
      new FakeLoyaltyReward(),
      ledger(rows),
      buildTestConfig(),
    );
    await expect(svc.myGallonDeposits('c1')).resolves.toEqual(rows);
  });

  it('passes null through rather than flattening it to an empty list', async () => {
    const svc = new ProfileService(
      new InMemoryProfileRepository(),
      new FakeLoyaltyReward(),
      ledger(null),
      buildTestConfig(),
    );
    await expect(svc.myGallonDeposits('c1')).resolves.toBeNull();
  });
});

describe('ProfileService birthday promo (FR-091)', () => {
  const TODAY = new Date('2026-05-17T09:00:00Z');
  let repo: InMemoryProfileRepository;
  let loyalty: FakeLoyaltyReward;
  let service: ProfileService;

  beforeEach(() => {
    repo = new InMemoryProfileRepository();
    loyalty = new FakeLoyaltyReward();
    service = new ProfileService(repo, loyalty, ledger(), buildTestConfig());
  });

  const withBirthday = async (id: string, iso: string) => {
    await service.setBirthdate(id, new Date(iso));
  };

  it('grants points to today’s birthday customers only, ignoring the year', async () => {
    await withBirthday('bday-a', '1990-05-17'); // birthday today
    await withBirthday('bday-b', '2001-05-17'); // birthday today, different year
    await withBirthday('other', '1990-05-18'); // not today

    const res = await service.runBirthdayRewards('Bearer admin', TODAY);

    expect(res).toMatchObject({ candidates: 2, granted: 2, failed: 0, disabled: false });
    expect(loyalty.calls.map((c) => c.customerId).sort()).toEqual(['bday-a', 'bday-b']);
    expect(loyalty.calls[0].points).toBe(250);
  });

  it('is idempotent within the same year (re-run grants nothing)', async () => {
    await withBirthday('bday-a', '1990-05-17');
    await service.runBirthdayRewards('Bearer admin', TODAY);
    loyalty.calls = [];

    const second = await service.runBirthdayRewards('Bearer admin', TODAY);
    expect(second).toMatchObject({ candidates: 0, granted: 0 });
    expect(loyalty.calls).toHaveLength(0);
  });

  it('does not stamp a customer whose grant failed, so it retries next run', async () => {
    await withBirthday('bday-a', '1990-05-17');
    loyalty.failFor.add('bday-a');
    const first = await service.runBirthdayRewards('Bearer admin', TODAY);
    expect(first).toMatchObject({ candidates: 1, granted: 0, failed: 1 });

    loyalty.failFor.clear();
    const retry = await service.runBirthdayRewards('Bearer admin', TODAY);
    expect(retry).toMatchObject({ candidates: 1, granted: 1, failed: 0 });
  });

  it('is a no-op when LOYALTY_SERVICE_URL is unset', async () => {
    const disabled = new ProfileService(
      repo,
      loyalty,
      ledger(),
      buildTestConfig({ LOYALTY_SERVICE_URL: '' }),
    );
    await withBirthday('bday-a', '1990-05-17');
    const res = await disabled.runBirthdayRewards('Bearer admin', TODAY);
    expect(res).toMatchObject({ candidates: 0, granted: 0, disabled: true });
    expect(loyalty.calls).toHaveLength(0);
  });
});

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService(new InMemoryNotificationRepository());
  });

  it('defaults to all channels on', async () => {
    const prefs = await service.get('cust-1');
    expect(prefs).toMatchObject({ push: true, email: true, whatsapp: true });
  });

  it('updates only the provided channels', async () => {
    await service.update('cust-1', { whatsapp: false });
    const prefs = await service.get('cust-1');
    expect(prefs).toMatchObject({ push: true, email: true, whatsapp: false });
  });
});
