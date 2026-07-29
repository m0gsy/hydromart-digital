import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import {
  EmailAlreadyRegisteredError,
  InvalidPhoneNumberError,
  PhoneAlreadyRegisteredError,
} from '../../src/domain/errors/auth.errors';
import { OtpService } from '../../src/application/services/otp.service';
import { ConsentService } from '../../src/application/services/consent.service';
import { RegistrationService } from '../../src/application/services/registration.service';
import { AuditService } from '../../src/application/services/audit.service';
import { AuditAction } from '../../src/application/services/audit.service';
import {
  FakeClock,
  FakeCrypto,
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
  InMemoryConsentRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

describe('RegistrationService', () => {
  let customers: InMemoryCustomerRepository;
  let otpTokens: InMemoryOtpTokenRepository;
  let audit: InMemoryAuditLogRepository;
  let delivery: FakeOtpDelivery;
  let service: RegistrationService;
  let clock: FakeClock;
  let consents: InMemoryConsentRepository;

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    clock = new FakeClock();
    otpTokens = new InMemoryOtpTokenRepository(() => clock.now());
    audit = new InMemoryAuditLogRepository();
    delivery = new FakeOtpDelivery();
    const otp = new OtpService(otpTokens, delivery, new FakeCrypto(), clock, buildTestConfig());
    consents = new InMemoryConsentRepository();
    service = new RegistrationService(customers, otp, new AuditService(audit), new ConsentService(consents));
  });

  it('creates a pending account and sends a registration OTP', async () => {
    const result = await service.register({ phone: '081234567890', fullName: 'Budi', context: ctx });

    expect(result.expiresInSeconds).toBe(300);
    expect(delivery.sent[0]?.purpose).toBe(OtpPurpose.REGISTRATION);
    const created = await customers.findByPhone('+6281234567890');
    expect(created?.status).toBe(CustomerStatus.PENDING_VERIFICATION);
    expect(created?.role).toBe(Role.CUSTOMER);
    expect(audit.actions()).toContain(AuditAction.REGISTER_REQUESTED);
  });

  it('re-issues the OTP when the phone is still pending (idempotent)', async () => {
    await service.register({ phone: '081234567890', context: ctx });
    clock.advance(61); // past the resend cooldown
    await service.register({ phone: '081234567890', context: ctx });

    // Only one account exists despite two registration attempts.
    const rows = [...customers.rows.values()].filter((c) => c.phone === '+6281234567890');
    expect(rows).toHaveLength(1);
    expect(delivery.sent).toHaveLength(2);
  });

  it('rejects registration for an already-active phone (BR-001)', async () => {
    customers.seed(makeCustomer({ phone: '+6281234567890', status: CustomerStatus.ACTIVE }));
    await expect(service.register({ phone: '081234567890', context: ctx })).rejects.toBeInstanceOf(
      PhoneAlreadyRegisteredError,
    );
  });

  it('rejects an email already used by another account', async () => {
    customers.seed(
      makeCustomer({ phone: '+6289999999999', email: 'taken@x.com', status: CustomerStatus.ACTIVE }),
    );
    await expect(
      service.register({ phone: '081234567890', email: 'taken@x.com', context: ctx }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('rejects an invalid phone number', async () => {
    await expect(service.register({ phone: '12345', context: ctx })).rejects.toBeInstanceOf(
      InvalidPhoneNumberError,
    );
  });
});

describe('RegistrationService consent ledger (UU PDP tahap 2)', () => {
  it('records TERMS + PRIVACY at signup, and MARKETING only when actually ticked', async () => {
    const customers = new InMemoryCustomerRepository();
    const clock = new FakeClock();
    const otp = new OtpService(
      new InMemoryOtpTokenRepository(() => clock.now()),
      new FakeOtpDelivery(),
      new FakeCrypto(),
      clock,
      buildTestConfig(),
    );
    const consents = new InMemoryConsentRepository();
    const service = new RegistrationService(
      customers,
      otp,
      new AuditService(new InMemoryAuditLogRepository()),
      new ConsentService(consents),
    );

    await service.register({
      phone: '081234567890',
      context: { ipAddress: null, userAgent: null },
    });

    expect(consents.rows.map((r) => r.purpose).sort()).toEqual(['PRIVACY', 'TERMS']);
    expect(consents.rows.every((r) => r.granted && r.source === 'registration')).toBe(true);

    // Re-registering the same pending phone re-issues the OTP; it must not stack rows.
    // Past the resend cooldown, or the second call fails for an unrelated reason.
    clock.advance(120);
    await service.register({
      phone: '081234567890',
      context: { ipAddress: null, userAgent: null },
    });
    expect(consents.rows).toHaveLength(2);
  });

  it('records MARKETING when the opt-in was ticked', async () => {
    const customers = new InMemoryCustomerRepository();
    const clock = new FakeClock();
    const otp = new OtpService(
      new InMemoryOtpTokenRepository(() => clock.now()),
      new FakeOtpDelivery(),
      new FakeCrypto(),
      clock,
      buildTestConfig(),
    );
    const consents = new InMemoryConsentRepository();
    const service = new RegistrationService(
      customers,
      otp,
      new AuditService(new InMemoryAuditLogRepository()),
      new ConsentService(consents),
    );

    await service.register({
      phone: '081234567891',
      marketingConsent: true,
      context: { ipAddress: null, userAgent: null },
    });

    expect(consents.rows.map((r) => r.purpose).sort()).toEqual(['MARKETING', 'PRIVACY', 'TERMS']);
  });
});
