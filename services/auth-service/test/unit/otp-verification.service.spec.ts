import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { OtpInvalidError } from '../../src/domain/errors/auth.errors';
import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { OtpService } from '../../src/application/services/otp.service';
import { OtpVerificationService } from '../../src/application/services/otp-verification.service';
import { SessionService } from '../../src/application/services/session.service';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  InMemoryRefreshTokenRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

describe('OtpVerificationService', () => {
  let customers: InMemoryCustomerRepository;
  let otpTokens: InMemoryOtpTokenRepository;
  let audit: InMemoryAuditLogRepository;
  let otp: OtpService;
  let service: OtpVerificationService;

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

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
      config,
    );
    service = new OtpVerificationService(customers, clock, otp, sessions, new AuditService(audit));
  });

  it('verifies a registration OTP, activates the account, and issues a session', async () => {
    const pending = makeCustomer({ status: CustomerStatus.PENDING_VERIFICATION, phoneVerifiedAt: null });
    customers.seed(pending);
    await otp.issue(pending, OtpPurpose.REGISTRATION);

    const session = await service.verify({
      phone: pending.phone,
      code: '123456',
      purpose: OtpPurpose.REGISTRATION,
      context: ctx,
    });

    expect(session.accessToken).toBe(`access:${pending.id}`);
    const activated = await customers.findById(pending.id);
    expect(activated?.status).toBe(CustomerStatus.ACTIVE);
    expect(audit.actions()).toEqual(
      expect.arrayContaining([AuditAction.OTP_VERIFIED, AuditAction.LOGIN_SUCCEEDED]),
    );
  });

  it('audits and rethrows on a wrong code', async () => {
    const active = makeCustomer();
    customers.seed(active);
    await otp.issue(active, OtpPurpose.LOGIN);

    await expect(
      service.verify({ phone: active.phone, code: '000000', purpose: OtpPurpose.LOGIN, context: ctx }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    expect(audit.actions()).toContain(AuditAction.OTP_FAILED);
  });

  it('does not disclose whether an unknown phone exists', async () => {
    await expect(
      service.verify({
        phone: '081234567890',
        code: '123456',
        purpose: OtpPurpose.LOGIN,
        context: ctx,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it('resends a code for an existing account', async () => {
    const active = makeCustomer();
    customers.seed(active);

    const result = await service.resend({ phone: active.phone, purpose: OtpPurpose.LOGIN, context: ctx });
    expect(result.expiresInSeconds).toBe(300);
    expect(audit.actions()).toContain(AuditAction.OTP_RESENT);
  });
});
