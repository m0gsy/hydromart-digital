import { Customer } from '../../src/domain/customer/customer.entity';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import {
  OtpInvalidError,
  OtpMaxAttemptsError,
  OtpResendCooldownError,
} from '../../src/domain/errors/auth.errors';
import { OtpService } from '../../src/application/services/otp.service';
import {
  FakeClock,
  FakeCrypto,
  FakeOtpDelivery,
  InMemoryOtpTokenRepository,
  buildTestConfig,
} from '../support/fakes';

const activeCustomer = (): Customer =>
  Customer.fromPersistence({
    id: 'cust-1',
    phone: '+6281234567890',
    email: null,
    fullName: null,
    role: Role.CUSTOMER,
    status: CustomerStatus.ACTIVE,
    googleSub: null,
    avatarUrl: null,
    assignedDepotId: null,
    vehicleType: null,
    plateNumber: null,
    phoneVerifiedAt: new Date(),
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe('OtpService', () => {
  let otpRepo: InMemoryOtpTokenRepository;
  let delivery: FakeOtpDelivery;
  let crypto: FakeCrypto;
  let clock: FakeClock;
  let service: OtpService;

  beforeEach(() => {
    delivery = new FakeOtpDelivery();
    crypto = new FakeCrypto();
    clock = new FakeClock();
    otpRepo = new InMemoryOtpTokenRepository(() => clock.now());
    service = new OtpService(otpRepo, delivery, crypto, clock, buildTestConfig());
  });

  it('issues a code, stores it hashed, and delivers it masked', async () => {
    const result = await service.issue(activeCustomer(), OtpPurpose.REGISTRATION);

    expect(delivery.sent).toHaveLength(1);
    expect(delivery.lastCode).toBe('123456');
    expect(otpRepo.rows[0].codeHash).toBe('hashed:123456');
    expect(result.expiresInSeconds).toBe(300);
    expect(result.phoneMasked).toBe('+6281******890');
  });

  it('enforces the resend cooldown', async () => {
    await service.issue(activeCustomer(), OtpPurpose.LOGIN);
    clock.advance(30); // less than the 60s cooldown
    await expect(service.issue(activeCustomer(), OtpPurpose.LOGIN)).rejects.toBeInstanceOf(
      OtpResendCooldownError,
    );
  });

  it('re-issues after the cooldown elapses and invalidates the old code', async () => {
    await service.issue(activeCustomer(), OtpPurpose.LOGIN);
    clock.advance(61);
    await service.issue(activeCustomer(), OtpPurpose.LOGIN);

    const active = otpRepo.rows.filter((r) => !r.consumedAt);
    expect(active).toHaveLength(1);
    expect(delivery.sent).toHaveLength(2);
  });

  it('verifies a correct code and consumes the challenge', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.REGISTRATION);

    await expect(service.verify(customer, OtpPurpose.REGISTRATION, '123456')).resolves.toBeUndefined();
    expect(otpRepo.rows[0].consumedAt).not.toBeNull();
  });

  it('rejects a wrong code and increments the attempt counter', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.REGISTRATION);

    await expect(service.verify(customer, OtpPurpose.REGISTRATION, '000000')).rejects.toBeInstanceOf(
      OtpInvalidError,
    );
    expect(otpRepo.rows[0].attempts).toBe(1);
  });

  it('locks the challenge after the maximum attempts', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.REGISTRATION);

    for (let i = 0; i < 4; i += 1) {
      await expect(
        service.verify(customer, OtpPurpose.REGISTRATION, '000000'),
      ).rejects.toBeInstanceOf(OtpInvalidError);
    }
    // 5th wrong attempt reaches the max and reports the lock.
    await expect(service.verify(customer, OtpPurpose.REGISTRATION, '000000')).rejects.toBeInstanceOf(
      OtpMaxAttemptsError,
    );
    // Even a correct code is now rejected.
    await expect(service.verify(customer, OtpPurpose.REGISTRATION, '123456')).rejects.toBeInstanceOf(
      OtpMaxAttemptsError,
    );
  });

  // B-4: the limit has to hold for guesses, not for rounds of guesses. Ten requests that
  // arrive together used to all read attempts=0, all pass the check, and all reach the
  // (deliberately slow) hash compare — five free guesses on a six-digit login code.
  it('does not hand out more guesses than the limit when the requests arrive together', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.LOGIN);
    const compare = jest.spyOn(crypto, 'verifySecret');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.verify(customer, OtpPurpose.LOGIN, '000000')),
    );

    expect(compare).toHaveBeenCalledTimes(5); // OTP_MAX_ATTEMPTS, not 10
    expect(otpRepo.rows[0].attempts).toBe(5);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('rejects an expired code', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.LOGIN);
    clock.advance(301);
    await expect(service.verify(customer, OtpPurpose.LOGIN, '123456')).rejects.toBeInstanceOf(
      OtpInvalidError,
    );
  });

  it('rejects verification when no challenge exists', async () => {
    await expect(
      service.verify(activeCustomer(), OtpPurpose.LOGIN, '123456'),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });
});
