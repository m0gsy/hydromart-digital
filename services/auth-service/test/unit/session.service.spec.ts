import { InvalidRefreshTokenError } from '../../src/domain/errors/auth.errors';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
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
    policy = new FakeSecurityPolicy();
    customerRepo = new InMemoryCustomerRepository();
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
   * CA-2-06: the idle-session limit head office set, finally applied.
   *
   * `idleTimeoutMinutes` had a screen, a DTO, a repository and a default of fifteen
   * minutes — and not one line outside admin-service ever read it. A console that lets
   * somebody set a session timeout and then does not time sessions out reports a control
   * that does not exist.
   */
  describe('idle-session limit (CA-2-06)', () => {
    const seed = async () => {
      const customer = makeCustomer();
      customerRepo.seed(customer);
      return service.issueForCustomer(customer, ctx);
    };

    it('refuses a session left unused past the limit, and ends its family', async () => {
      policy.minutes = 15;
      const first = await seed();
      clock.advance(16 * 60);

      await expect(service.refresh(first.refreshToken, ctx)).rejects.toThrow(/idle/i);
      // The family goes with it: an abandoned session must not be resumable from another
      // device still holding an older token in the same chain.
      expect(refreshRepo.rows.every((r) => r.revokedAt !== null)).toBe(true);
    });

    it('lets a session inside the limit through, and the clock restarts on use', async () => {
      policy.minutes = 15;
      const first = await seed();
      clock.advance(10 * 60);

      const rotated = await service.refresh(first.refreshToken, ctx);
      // Ten more minutes: twenty since sign-in, but only ten since the last use — and it is
      // the last USE the limit measures.
      clock.advance(10 * 60);
      await expect(service.refresh(rotated.refreshToken, ctx)).resolves.toBeTruthy();
    });

    /*
     * The heart of it. A security control that logs the whole business out when the service
     * holding it restarts is an outage wearing a policy's clothes — so `null` (no limit) is
     * both "head office set none" and "the policy could not be read", deliberately
     * indistinguishable. The env-driven refresh TTL still bounds every session.
     */
    it('signs nobody out when the policy cannot be read', async () => {
      policy.minutes = null;
      const first = await seed();
      clock.advance(60 * 24 * 60);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });

    it('treats a zero or negative limit as no limit, not as instant logout', async () => {
      policy.minutes = 0;
      const first = await seed();
      clock.advance(60 * 60);

      await expect(service.refresh(first.refreshToken, ctx)).resolves.toBeTruthy();
    });
  });
});
