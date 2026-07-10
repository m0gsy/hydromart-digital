import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import {
  EmailAlreadyRegisteredError,
  InvalidPhoneNumberError,
  PhoneAlreadyRegisteredError,
} from '../../src/domain/errors/auth.errors';
import { OtpService } from '../../src/application/services/otp.service';
import { RegistrationService } from '../../src/application/services/registration.service';
import { AuditService } from '../../src/application/services/audit.service';
import { AuditAction } from '../../src/application/services/audit.service';
import {
  FakeClock,
  FakeCrypto,
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
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

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    clock = new FakeClock();
    otpTokens = new InMemoryOtpTokenRepository(() => clock.now());
    audit = new InMemoryAuditLogRepository();
    delivery = new FakeOtpDelivery();
    const otp = new OtpService(otpTokens, delivery, new FakeCrypto(), clock, buildTestConfig());
    service = new RegistrationService(customers, otp, new AuditService(audit));
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
