import { SecurityPolicyService } from '../../src/application/services/security-policy.service';
import { InMemorySecurityPolicyRepository } from '../support/fakes';

describe('SecurityPolicyService', () => {
  let repo: InMemorySecurityPolicyRepository;
  let service: SecurityPolicyService;

  beforeEach(() => {
    repo = new InMemorySecurityPolicyRepository();
    service = new SecurityPolicyService(repo);
  });

  it('returns platform defaults before anything is saved', async () => {
    const p = await service.get();
    // Off: the idle limit applies to head-office accounts only and is a decision, not a default.
    expect(p).toMatchObject({ idleTimeoutMinutes: 0, require2fa: true, ipAllowlist: [] });
  });

  it('saves and reads back the policy', async () => {
    await service.save({
      idleTimeoutMinutes: 30,
      require2fa: false,
      ipAllowlist: ['103.21.0.0/16'],
    });
    const p = await service.get();
    expect(p).toMatchObject({
      idleTimeoutMinutes: 30,
      require2fa: false,
      ipAllowlist: ['103.21.0.0/16'],
    });
  });

  /*
   * The idle limit is off (0) or 30–1440. A value in between is refused, not rounded:
   * below 30 minutes the measurement (accurate to one access-token lifetime) would sign
   * out people who are working.
   */
  it.each([0, 30, 480, 1440])('accepts an idle limit of %i', async (idle) => {
    await service.save({ idleTimeoutMinutes: idle, require2fa: true, ipAllowlist: [] });
    expect((await service.get()).idleTimeoutMinutes).toBe(idle);
  });

  it.each([1, 15, 29, 1441, -5])('refuses an idle limit of %i', async (idle) => {
    await expect(
      service.save({ idleTimeoutMinutes: idle, require2fa: true, ipAllowlist: [] }),
    ).rejects.toMatchObject({ code: 'IDLE_LIMIT_OUT_OF_RANGE', status: 400 });
  });

  /*
   * CA-2-53. Two HQ admins hold this page open; the second save used to erase the first's
   * change with neither of them told — on the row that decides who can reach the console
   * at all.
   */
  it('refuses a save built on a copy that is already out of date', async () => {
    const first = await service.save({
      idleTimeoutMinutes: 30,
      require2fa: true,
      ipAllowlist: [],
    });
    // The second admin loaded the page before that save landed, so their copy is older.
    await expect(
      service.save(
        { idleTimeoutMinutes: 60, require2fa: false, ipAllowlist: [] },
        new Date(first.updatedAt.getTime() - 1000).toISOString(),
      ),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
    expect((await service.get()).idleTimeoutMinutes).toBe(30);
  });

  it('accepts a save from someone looking at the current row', async () => {
    const first = await service.save({
      idleTimeoutMinutes: 30,
      require2fa: true,
      ipAllowlist: [],
    });
    const second = await service.save(
      { idleTimeoutMinutes: 45, require2fa: true, ipAllowlist: [] },
      first.updatedAt.toISOString(),
    );
    expect(second.idleTimeoutMinutes).toBe(45);
  });

  it('refuses a save that says nothing about what it saw, once a row exists', async () => {
    // Fails closed: a client that names no version is exactly the one that overwrites
    // blindly, which is the behaviour this replaces.
    await service.save({ idleTimeoutMinutes: 30, require2fa: true, ipAllowlist: [] });
    await expect(
      service.save({ idleTimeoutMinutes: 60, require2fa: true, ipAllowlist: [] }),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
});
