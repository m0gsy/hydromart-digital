import {
  InvalidRefreshTokenError,
  RefreshTokenRotatedError,
} from '../../src/domain/errors/auth.errors';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { SessionService } from '../../src/application/services/session.service';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
  FakeSecurityPolicy,
  InMemoryCustomerRepository,
  InMemoryRefreshTokenRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

describe('SessionService', () => {
  let refreshRepo: InMemoryRefreshTokenRepository;
  let customerRepo: InMemoryCustomerRepository;
  let crypto: FakeCrypto;
  let clock: FakeClock;
  let service: SessionService;
  let policy: FakeSecurityPolicy;

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    refreshRepo = new InMemoryRefreshTokenRepository();
    customerRepo = new InMemoryCustomerRepository();
    policy = new FakeSecurityPolicy();
    crypto = new FakeCrypto();
    clock = new FakeClock();
    service = new SessionService(
      refreshRepo,
      customerRepo,
      new FakeAccessTokenSigner(),
      crypto,
      clock,
      policy,
      buildTestConfig(),
    );
  });

  it('issues an access + refresh token pair for a customer', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);

    const session = await service.issueForCustomer(customer, ctx);

    expect(session.tokenType).toBe('Bearer');
    expect(session.accessToken).toBe(`access:${customer.id}`);
    expect(session.refreshToken).toBe('opaque-1');
    expect(session.expiresIn).toBe(900);
    expect(refreshRepo.rows).toHaveLength(1);
    expect(refreshRepo.rows[0].tokenHash).toBe('hmac:opaque-1');
  });

  it('rotates the refresh token and revokes the previous one', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);
    const first = await service.issueForCustomer(customer, ctx);

    const rotated = await service.refresh(first.refreshToken, ctx);

    expect(rotated.refreshToken).toBe('opaque-2');
    const oldRecord = refreshRepo.rows.find((r) => r.tokenHash === 'hmac:opaque-1');
    const newRecord = refreshRepo.rows.find((r) => r.tokenHash === 'hmac:opaque-2');
    expect(oldRecord?.revokedAt).not.toBeNull();
    expect(oldRecord?.replacedById).toBe(newRecord?.id);
    expect(newRecord?.familyId).toBe(oldRecord?.familyId); // same family
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);
    const first = await service.issueForCustomer(customer, ctx);
    await service.refresh(first.refreshToken, ctx); // rotates; first is now revoked
    clock.advance(60); // past the rotation grace: this is a replay, not a lost race

    // Replaying the original (already-rotated) token is treated as theft.
    await expect(service.refresh(first.refreshToken, ctx)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    const active = refreshRepo.rows.filter((r) => !r.revokedAt);
    expect(active).toHaveLength(0);
  });

  it('rejects an unknown refresh token', async () => {
    await expect(service.refresh('does-not-exist', ctx)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects an expired refresh token', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);
    const first = await service.issueForCustomer(customer, ctx);
    clock.advance(2592001); // just past the refresh TTL
    await expect(service.refresh(first.refreshToken, ctx)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('refuses to refresh a suspended account', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);
    const first = await service.issueForCustomer(customer, ctx);
    // Suspend the account after the session was issued.
    const suspended = makeCustomer({ id: customer.id, status: CustomerStatus.SUSPENDED });
    customerRepo.seed(suspended);
    await expect(service.refresh(first.refreshToken, ctx)).rejects.toThrow();
  });

  it('revokes a single session on logout', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);
    const session = await service.issueForCustomer(customer, ctx);

    await service.revokeByToken(session.refreshToken);
    expect(refreshRepo.rows[0].revokedAt).not.toBeNull();
  });

  describe('lost races on one cookie', () => {
    // The OTHER request commits between this one's read and its claim: simulated by revoking
    // the parent inside `rotate`, right before the real claim runs.
    const loseTo = (revokeParent: (parentId: string) => void) => {
      const real = refreshRepo.rotate.bind(refreshRepo);
      jest.spyOn(refreshRepo, 'rotate').mockImplementation(async (oldId, at, data) => {
        revokeParent(oldId);
        return real(oldId, at, data);
      });
    };

    it('a refresh that loses to a concurrent rotation mints nothing and is told to retry', async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      const first = await service.issueForCustomer(customer, ctx);
      loseTo((id) => {
        const row = refreshRepo.rows.find((r) => r.id === id)!;
        row.revokedAt = clock.now();
        row.replacedById = 'rt-winner';
      });

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toBeInstanceOf(
        RefreshTokenRotatedError,
      );
      // No second live child: the loser's token was never persisted.
      expect(refreshRepo.rows).toHaveLength(1);
    });

    it('a refresh that loses to a logout-everywhere ends the family instead of forking it', async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      const first = await service.issueForCustomer(customer, ctx);
      loseTo((id) => {
        refreshRepo.rows.find((r) => r.id === id)!.revokedAt = clock.now(); // no replacedById
      });

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toBeInstanceOf(
        InvalidRefreshTokenError,
      );
      expect(refreshRepo.rows.filter((r) => !r.revokedAt)).toHaveLength(0);
    });
  });

  describe('logout with a cookie that was already rotated', () => {
    it('ends the family once the grace window has passed, so the child is not left running', async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      const first = await service.issueForCustomer(customer, ctx);
      await service.refresh(first.refreshToken, ctx);
      clock.advance(60);

      await service.revokeByToken(first.refreshToken);

      expect(refreshRepo.rows.filter((r) => !r.revokedAt)).toHaveLength(0);
    });

    it('leaves the new session alone inside the grace window (the old cookie arrived late)', async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      const first = await service.issueForCustomer(customer, ctx);
      await service.refresh(first.refreshToken, ctx);

      await service.revokeByToken(first.refreshToken);

      expect(refreshRepo.rows.filter((r) => !r.revokedAt)).toHaveLength(1);
    });

    it('does nothing for an unknown cookie or one revoked without a successor', async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      const first = await service.issueForCustomer(customer, ctx);

      await service.revokeByToken('never-issued');
      await service.revokeByToken(first.refreshToken); // plain logout
      clock.advance(60);
      await service.revokeByToken(first.refreshToken); // logging out twice

      expect(refreshRepo.rows).toHaveLength(1);
    });
  });

  it('revokes all sessions and lists only active ones', async () => {
    const customer = makeCustomer();
    customerRepo.seed(customer);
    await service.issueForCustomer(customer, ctx);
    await service.issueForCustomer(customer, ctx);

    expect(await service.listActive(customer.id)).toHaveLength(2);
    await service.revokeAll(customer.id);
    expect(await service.listActive(customer.id)).toHaveLength(0);
  });
  /*
   * A session ends when it has gone unused for the whole refresh lifetime (30 days), and
   * not before. Every sign-out costs an SMS OTP to get back in, so there is no shorter idle
   * limit — and a limit measured from the last refresh could not be made to fit anyway: a
   * refresh only happens when the 15-minute access token has run out, so an actively used
   * session looks "idle" for at least one access-token lifetime every single time.
   */
  /*
   * Two tabs refreshing on the same cookie. The second request carries the token the first
   * has just rotated away, and used to be answered by revoking the whole family — a sign-out
   * for somebody who did nothing but have two tabs open, and one SMS OTP to get back in.
   */
  describe('rotation grace', () => {
    const seed = async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      return service.issueForCustomer(customer, ctx);
    };

    it('does not end the family when a just-rotated token is presented again', async () => {
      const first = await seed();
      const rotated = await service.refresh(first.refreshToken, ctx);
      clock.advance(5);

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_ROTATED',
        status: 409,
      });
      // Nothing was issued to the loser, and the winner's token still works.
      await expect(service.refresh(rotated.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('still treats a replay after the window as theft and ends the family', async () => {
      const first = await seed();
      await service.refresh(first.refreshToken, ctx);
      clock.advance(31);

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toThrow(/terminated/i);
      expect(refreshRepo.rows.every((r) => r.revokedAt !== null)).toBe(true);
    });

    it('does not extend the grace to a token that was logged out, not rotated', async () => {
      const first = await seed();
      await service.revokeByToken(first.refreshToken);
      clock.advance(1);

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toThrow(/terminated/i);
    });
  });

  /*
   * The idle limit head office may set applies to head-office accounts ONLY, and measures
   * real inactivity: the access-token lifetime is not idleness. See HQ_IDLE_LIMIT.
   */
  describe('idle limit for head-office accounts', () => {
    const seedAs = async (role: Role) => {
      const customer = makeCustomer({ role });
      customerRepo.seed(customer);
      return service.issueForCustomer(customer, ctx);
    };

    it('does not sign out a head-office user who is working, at the access-token expiry', async () => {
      policy.minutes = 30;
      const first = await seedAs(Role.FINANCE);
      clock.advance(900 + 1);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('signs out a head-office user who left past the limit, and ends the family', async () => {
      policy.minutes = 30;
      const first = await seedAs(Role.SUPER_ADMIN);
      clock.advance(60 * 60);

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toThrow(/idle/i);
      expect(refreshRepo.rows.every((r) => r.revokedAt !== null)).toBe(true);
    });

    it('keeps a head-office user whose absence is shorter than the limit', async () => {
      policy.minutes = 60;
      const first = await seedAs(Role.DIREKTUR);
      clock.advance(40 * 60);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it.each([Role.CUSTOMER, Role.STAFF_DEPOT, Role.KEPALA_DEPOT, Role.MANAGER])(
      'never signs out a %s for idleness, however long',
      async (role) => {
        policy.minutes = 30;
        const first = await seedAs(role);
        clock.advance(20 * 24 * 60 * 60);

        await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
      },
    );

    it('is off unless head office turned it on', async () => {
      policy.minutes = null;
      const first = await seedAs(Role.HEAD_OFFICE);
      clock.advance(24 * 60 * 60);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('ignores a limit below the minimum rather than signing out working people', async () => {
      policy.minutes = 15;
      const first = await seedAs(Role.FINANCE);
      clock.advance(900 + 1);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });
  });

  describe('session lifetime', () => {
    const DAY = 24 * 60 * 60;
    const seed = async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      return service.issueForCustomer(customer, ctx);
    };

    it('does not sign out somebody who is using the app, at the access-token expiry', async () => {
      const first = await seed();
      // The access token (900 s) has just run out; the client refreshes for the first time.
      clock.advance(900 + 1);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('keeps a session that is refreshed every fifteen minutes for a day', async () => {
      let session = await seed();
      for (let i = 0; i < 96; i++) {
        clock.advance(901);
        session = await service.refresh(session.refreshToken, ctx);
      }
      expect(session.refreshToken).toBeTruthy();
    });

    it('lets a phone left alone for most of a month come back without a new OTP', async () => {
      const first = await seed();
      clock.advance(29 * DAY);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('slides the window: a refresh starts a fresh thirty days', async () => {
      const first = await seed();
      clock.advance(20 * DAY);
      const rotated = await service.refresh(first.refreshToken, ctx);
      // Forty days since sign-in, twenty since the last use.
      clock.advance(20 * DAY);

      await expect(service.refresh(rotated.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('ends a session that was not opened for the whole thirty days', async () => {
      const first = await seed();
      clock.advance(31 * DAY);

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toThrow(/expired/i);
    });
  });
});
