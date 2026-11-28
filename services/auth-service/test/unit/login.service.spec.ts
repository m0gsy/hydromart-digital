import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { NotStaffError, StaffAccountError } from '../../src/domain/errors/auth.errors';
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

  it('keeps the audit shape unchanged when no sessionDrop or app build is sent', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    await service.requestLogin({ phone: customer.phone, context: ctx });
    expect(audit.entries.at(-1)?.metadata).toBeUndefined();
  });

  it('puts sessionDrop and the app build in the audit metadata', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    await service.requestLogin({
      phone: customer.phone,
      sessionDrop: 'vault_empty',
      appId: 'id.hydromart.ops',
      appVersion: '11301',
      context: ctx,
    });
    expect(audit.entries.at(-1)?.metadata).toEqual({
      sessionDrop: 'vault_empty',
      appId: 'id.hydromart.ops',
      appVersion: '11301',
    });
  });

  // HD-8: this door signs people up too, so it keeps where they came from, like /register.
  it('keeps the campaign codes on a number it signs up, and a lone one as both', async () => {
    const create = jest.spyOn(customers, 'create');
    await service.requestLogin({
      phone: '081234567890',
      firstSource: 'pameran',
      lastSource: 'meta-iklan',
      context: ctx,
    });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstSource: 'pameran', lastSource: 'meta-iklan' }),
    );
    await service.requestLogin({ phone: '081234567891', lastSource: 'qr-depot', context: ctx });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstSource: 'qr-depot', lastSource: 'qr-depot' }),
    );
    await service.requestLogin({ phone: '081234567892', context: ctx });
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstSource: null, lastSource: null }),
    );
  });

  it('creates nothing, and so records no code, for a number that already has an account', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    const create = jest.spyOn(customers, 'create');
    await service.requestLogin({ phone: customer.phone, firstSource: 'pameran', context: ctx });
    expect(create).not.toHaveBeenCalled();
    expect((await customers.findByPhone(customer.phone))?.firstSource).toBeNull();
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

  /*
   * Owner decision 2026-11-20. The staff doors (Ops app, /hq/login, manager login) signed an
   * unknown number up as a customer, so staff whose HR record carried a wrong number landed
   * in the shop — and that customer account then blocked HR's correction.
   */
  describe('from a staff door', () => {
    it('refuses an unknown number and creates nothing', async () => {
      await expect(
        service.requestLogin({ phone: '081234567890', audience: 'STAFF', context: ctx }),
      ).rejects.toBeInstanceOf(NotStaffError);
      expect(await customers.findByPhone('+6281234567890')).toBeNull();
      expect(delivery.sent).toHaveLength(0);
    });

    it('refuses a customer number the same way, and sends no code', async () => {
      customers.seed(makeCustomer());
      await expect(
        service.requestLogin({ phone: makeCustomer().phone, audience: 'STAFF', context: ctx }),
      ).rejects.toBeInstanceOf(NotStaffError);
      expect(delivery.sent).toHaveLength(0);
    });

    it('lets a staff login through with a LOGIN code, from a staff door', async () => {
      customers.seed(makeCustomer({ role: Role.STAFF_DEPOT }));
      const result = await service.requestLogin({
        phone: makeCustomer().phone,
        audience: 'STAFF',
        context: ctx,
      });
      expect(result.purpose).toBe('LOGIN');
      expect(delivery.sent[0]?.purpose).toBe(OtpPurpose.LOGIN);
    });
  });

  // Owner decision 2026-11-20: staff sign in to the Ops app. The customer binary carries none of
  // the consoles a staff session lands on, so it opened on screens that do not exist.
  describe('from the customer app', () => {
    it('refuses a staff login and sends no code', async () => {
      customers.seed(makeCustomer({ role: Role.KEPALA_DEPOT }));
      await expect(
        service.requestLogin({ phone: makeCustomer().phone, audience: 'CUSTOMER', context: ctx }),
      ).rejects.toBeInstanceOf(StaffAccountError);
      expect(delivery.sent).toHaveLength(0);
    });

    it('still signs up an unknown number and lets a customer in', async () => {
      const fresh = await service.requestLogin({
        phone: '081234567891',
        audience: 'CUSTOMER',
        context: ctx,
      });
      expect(fresh.purpose).toBe('REGISTRATION');

      customers.seed(makeCustomer());
      const back = await service.requestLogin({
        phone: makeCustomer().phone,
        audience: 'CUSTOMER',
        context: ctx,
      });
      expect(back.purpose).toBe('LOGIN');
    });
  });
});
