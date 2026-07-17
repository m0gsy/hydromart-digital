import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { CustomerNotFoundError } from '../../src/domain/errors/auth.errors';
import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { LoginService } from '../../src/application/services/login.service';
import { OtpService } from '../../src/application/services/otp.service';
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

describe('LoginService', () => {
  let customers: InMemoryCustomerRepository;
  let delivery: FakeOtpDelivery;
  let audit: InMemoryAuditLogRepository;
  let service: LoginService;

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    delivery = new FakeOtpDelivery();
    audit = new InMemoryAuditLogRepository();
    const clock = new FakeClock();
    const crypto = new FakeCrypto();
    const config = buildTestConfig();
    const otp = new OtpService(new InMemoryOtpTokenRepository(), delivery, crypto, clock, config);
    service = new LoginService(customers, otp, new AuditService(audit));
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
});
