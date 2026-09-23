import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
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

  /*
   * AUTH-3. Login answered 404 `AUTH_CUSTOMER_NOT_FOUND` for a number with no account —
   * an enumeration oracle anybody could run: post a number, read the status, learn whether
   * that person banks here. One door now: the number is registered and gets a code, and the
   * answer has the same shape either way.
   */
  it('registers an unknown phone and issues a code, instead of saying it is unknown', async () => {
    const result = await service.requestLogin({ phone: '081234567890', context: ctx });

    expect(result.purpose).toBe('REGISTRATION');
    expect(result.expiresInSeconds).toBe(300);
    expect(delivery.sent[0]?.purpose).toBe(OtpPurpose.REGISTRATION);
    expect(audit.actions()).toContain(AuditAction.REGISTER_REQUESTED);
    expect(await customers.findByPhone('+6281234567890')).not.toBeNull();
  });

  it('answers a half-finished signup the same way, so the two are indistinguishable', async () => {
    const pending = makeCustomer({ status: CustomerStatus.PENDING_VERIFICATION });
    customers.seed(pending);

    const result = await service.requestLogin({ phone: pending.phone, context: ctx });
    expect(result.purpose).toBe('REGISTRATION');
  });

  it('says LOGIN for an account that can actually sign in', async () => {
    customers.seed(makeCustomer());
    const result = await service.requestLogin({ phone: makeCustomer().phone, context: ctx });
    expect(result.purpose).toBe('LOGIN');
  });

  /*
   * SUSPENDED and DELETED still refuse, deliberately: those owners need to be told
   * something specific, and silently issuing codes nobody can use makes a support call
   * unanswerable. They are not the enumeration surface either — reaching that state needs
   * an account that existed and was acted on by staff.
   */
  it('still refuses an account staff have suspended', async () => {
    customers.seed(makeCustomer({ status: CustomerStatus.SUSPENDED }));
    await expect(
      service.requestLogin({ phone: makeCustomer().phone, context: ctx }),
    ).rejects.toThrow();
  });
});
