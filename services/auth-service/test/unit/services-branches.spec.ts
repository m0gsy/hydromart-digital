import {
  CustomerNotFoundError,
  InvalidRefreshTokenError,
  OtpInvalidError,
} from '../../src/domain/errors/auth.errors';
import { Role } from '../../src/domain/customer/role.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { AccountService } from '../../src/application/services/account.service';
import { AuditService } from '../../src/application/services/audit.service';
import { OtpService } from '../../src/application/services/otp.service';
import { OtpVerificationService } from '../../src/application/services/otp-verification.service';
import { SessionService } from '../../src/application/services/session.service';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
  FakeOtpDelivery,
  FakeSecurityPolicy,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  InMemoryRefreshTokenRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

describe('AccountService branch gaps', () => {
  let customers: InMemoryCustomerRepository;
  let sessions: SessionService;
  let refreshRepo: InMemoryRefreshTokenRepository;
  let audit: InMemoryAuditLogRepository;
  let clock: FakeClock;
  let service: AccountService;

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    refreshRepo = new InMemoryRefreshTokenRepository();
    audit = new InMemoryAuditLogRepository();
    clock = new FakeClock();
    sessions = new SessionService(
      refreshRepo,
      customers,
      new FakeAccessTokenSigner(),
      new FakeCrypto(),
      clock,
      new FakeSecurityPolicy(),
      buildTestConfig(),
    );
    service = new AccountService(customers, sessions, new AuditService(audit));
  });

  it('resolves a customer by a non-E.164 phone form', async () => {
    const customer = makeCustomer({ phone: '+6281234567890' });
    customers.seed(customer);
    const found = await service.lookupByPhone('081234567890');
    expect(found.id).toBe(customer.id);
  });

  it('404s a phone lookup with no match', async () => {
    await expect(service.lookupByPhone('081299998888')).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
  });

  it('404s a profile update for a missing account', async () => {
    await expect(service.updateProfile('missing', { fullName: 'X' })).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
  });

  it('sets the avatar url on the account', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    const updated = await service.setAvatar(customer.id, 'https://cdn/a.png');
    expect(updated.avatarUrl).toBe('https://cdn/a.png');
  });

  it('404s an avatar update for a missing account', async () => {
    await expect(service.setAvatar('missing', 'https://cdn/a.png')).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
  });

  it('renames an existing account while promoting it to staff', async () => {
    const customer = makeCustomer({ phone: '+628990002222', role: Role.CUSTOMER, fullName: 'Old' });
    customers.seed(customer);
    const promoted = await service.inviteStaff(
      '+628990002222',
      Role.MANAGER,
      'New Name',
      'depot-1',
    );
    expect(promoted.role).toBe(Role.MANAGER);
    expect(promoted.fullName).toBe('New Name');
  });

  it('delegates a single-session revoke to the session service', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    const issued = await sessions.issueForCustomer(customer, ctx);
    const sessionId = refreshRepo.rows[0].id;
    void issued;

    expect(await service.revokeSession(customer.id, sessionId)).toBe(true);
    expect(await service.revokeSession(customer.id, 'not-a-session')).toBe(false);
  });
});

describe('SessionService branch gaps', () => {
  let customers: InMemoryCustomerRepository;
  let refreshRepo: InMemoryRefreshTokenRepository;
  let clock: FakeClock;
  let service: SessionService;

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    refreshRepo = new InMemoryRefreshTokenRepository();
    clock = new FakeClock();
    service = new SessionService(
      refreshRepo,
      customers,
      new FakeAccessTokenSigner(),
      new FakeCrypto(),
      clock,
      new FakeSecurityPolicy(),
      buildTestConfig(),
    );
  });

  it('rejects a refresh whose owner account has vanished', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    const first = await service.issueForCustomer(customer, ctx);
    customers.rows.delete(customer.id); // account deleted between issue and refresh

    await expect(service.refresh(first.refreshToken, ctx)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('revokes a session family the customer owns and reports true', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    await service.issueForCustomer(customer, ctx);
    const sessionId = refreshRepo.rows[0].id;

    expect(await service.revokeSession(customer.id, sessionId)).toBe(true);
    expect(refreshRepo.rows[0].revokedAt).not.toBeNull();
  });

  it('returns false revoking a session that is not the callers active one', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    await service.issueForCustomer(customer, ctx);
    expect(await service.revokeSession(customer.id, 'someone-elses-session')).toBe(false);
  });
});

describe('OtpVerificationService branch gaps', () => {
  let customers: InMemoryCustomerRepository;
  let otpTokens: InMemoryOtpTokenRepository;
  let audit: InMemoryAuditLogRepository;
  let otp: OtpService;
  let service: OtpVerificationService;

  const failingNotifications = {
    sendWelcome: jest.fn().mockRejectedValue(new Error('crm down')),
  };

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    otpTokens = new InMemoryOtpTokenRepository();
    audit = new InMemoryAuditLogRepository();
    const clock = new FakeClock();
    const crypto = new FakeCrypto();
    const config = buildTestConfig();
    otp = new OtpService(otpTokens, new FakeOtpDelivery(), crypto, clock, config);
    const sessions = new SessionService(
      new InMemoryRefreshTokenRepository(),
      customers,
      new FakeAccessTokenSigner(),
      crypto,
      clock,
      new FakeSecurityPolicy(),
      config,
    );
    service = new OtpVerificationService(
      customers,
      clock,
      failingNotifications as never,
      otp,
      sessions,
      new AuditService(audit),
    );
    failingNotifications.sendWelcome.mockClear();
  });

  it('completes registration even when the welcome notification rejects (fail-open)', async () => {
    const pending = makeCustomer({
      status: CustomerStatus.PENDING_VERIFICATION,
      phoneVerifiedAt: null,
    });
    customers.seed(pending);
    await otp.issue(pending, OtpPurpose.REGISTRATION);

    const session = await service.verify({
      phone: pending.phone,
      code: '123456',
      purpose: OtpPurpose.REGISTRATION,
      context: ctx,
    });

    expect(session.accessToken).toBe(`access:${pending.id}`);
    expect(failingNotifications.sendWelcome).toHaveBeenCalled();
  });

  it('404s a resend for an unknown phone number', async () => {
    await expect(
      service.resend({ phone: '081200000000', purpose: OtpPurpose.LOGIN, context: ctx }),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('still rejects verification for an unknown phone (no disclosure)', async () => {
    await expect(
      service.verify({
        phone: '081200000000',
        code: '123456',
        purpose: OtpPurpose.LOGIN,
        context: ctx,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });
});
