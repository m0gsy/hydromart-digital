import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import {
  CustomerNotFoundError,
  InvalidGoogleTokenError,
} from '../../src/domain/errors/auth.errors';
import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { LoginService } from '../../src/application/services/login.service';
import { OtpService } from '../../src/application/services/otp.service';
import { SessionService } from '../../src/application/services/session.service';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
  FakeGoogleVerifier,
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  InMemoryRefreshTokenRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

describe('LoginService', () => {
  let customers: InMemoryCustomerRepository;
  let google: FakeGoogleVerifier;
  let delivery: FakeOtpDelivery;
  let audit: InMemoryAuditLogRepository;
  let service: LoginService;

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    google = new FakeGoogleVerifier();
    delivery = new FakeOtpDelivery();
    audit = new InMemoryAuditLogRepository();
    const clock = new FakeClock();
    const crypto = new FakeCrypto();
    const config = buildTestConfig();
    const otp = new OtpService(new InMemoryOtpTokenRepository(), delivery, crypto, clock, config);
    const sessions = new SessionService(
      new InMemoryRefreshTokenRepository(),
      customers,
      new FakeAccessTokenSigner(),
      crypto,
      clock,
      config,
    );
    service = new LoginService(customers, google, clock, otp, sessions, new AuditService(audit));
  });

  it('issues a login OTP for a registered, active customer', async () => {
    const customer = makeCustomer();
    customers.seed(customer);

    const result = await service.requestLogin({ phone: customer.phone, context: ctx });
    expect(result.expiresInSeconds).toBe(300);
    expect(delivery.sent[0]?.purpose).toBe(OtpPurpose.LOGIN);
    expect(audit.actions()).toContain(AuditAction.LOGIN_REQUESTED);
  });

  it('rejects login for an unknown phone', async () => {
    await expect(
      service.requestLogin({ phone: '081234567890', context: ctx }),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('signs in via Google when matched by subject id', async () => {
    const customer = makeCustomer({ googleSub: 'google-1' });
    customers.seed(customer);
    google.identity = { sub: 'google-1', email: 'budi@x.com', emailVerified: true, name: 'Budi' };

    const session = await service.googleSignIn({ idToken: 'x.y.z', context: ctx });
    expect(session.accessToken).toBe(`access:${customer.id}`);
    expect(audit.actions()).toContain(AuditAction.GOOGLE_SIGNIN);
  });

  it('links Google to an existing account matched by verified email', async () => {
    const customer = makeCustomer({ email: 'budi@x.com' });
    customers.seed(customer);
    google.identity = { sub: 'google-2', email: 'budi@x.com', emailVerified: true, name: 'Budi' };

    const session = await service.googleSignIn({ idToken: 'x.y.z', context: ctx });
    expect(session.accessToken).toBe(`access:${customer.id}`);
    const linked = await customers.findById(customer.id);
    expect(linked?.googleSub).toBe('google-2');
  });

  it('rejects Google sign-in with no linked account', async () => {
    google.identity = { sub: 'google-3', email: 'new@x.com', emailVerified: true, name: 'New' };
    await expect(service.googleSignIn({ idToken: 'x.y.z', context: ctx })).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
  });

  it('propagates an invalid Google token error', async () => {
    google.error = new InvalidGoogleTokenError();
    await expect(service.googleSignIn({ idToken: 'bad', context: ctx })).rejects.toBeInstanceOf(
      InvalidGoogleTokenError,
    );
  });

  it('does not sign in a suspended account via Google', async () => {
    const customer = makeCustomer({ googleSub: 'google-4', status: CustomerStatus.SUSPENDED });
    customers.seed(customer);
    google.identity = { sub: 'google-4', email: null, emailVerified: false, name: null };
    await expect(service.googleSignIn({ idToken: 'x.y.z', context: ctx })).rejects.toThrow();
  });
});
