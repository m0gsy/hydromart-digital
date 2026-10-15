import { InvalidRefreshTokenError } from '../../src/domain/errors/auth.errors';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { SessionService } from '../../src/application/services/session.service';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
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

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    refreshRepo = new InMemoryRefreshTokenRepository();
    customerRepo = new InMemoryCustomerRepository();
    crypto = new FakeCrypto();
    clock = new FakeClock();
    service = new SessionService(
      refreshRepo,
      customerRepo,
      new FakeAccessTokenSigner(),
      crypto,
      clock,
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
   * A session ends when it has gone unused for the whole refresh lifetime (30 days), and
   * not before. Every sign-out costs an SMS OTP to get back in, so there is no shorter idle
   * limit — and a limit measured from the last refresh could not be made to fit anyway: a
   * refresh only happens when the 15-minute access token has run out, so an actively used
   * session looks "idle" for at least one access-token lifetime every single time.
   */
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
