import { Customer } from '../../src/domain/customer/customer.entity';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import {
  OtpDeliveryUnavailableError,
  OtpExpiredError,
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

const activeCustomer = (phone = '+6281234567890'): Customer =>
  Customer.fromPersistence({
    id: 'cust-1',
    phone,
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

  /**
   * J6. A Play reviewer cannot receive an Indonesian SMS, so one nominated number gets a
   * code that does not change. What these prove is mostly what it does NOT do: it does not
   * exist unless both values are set, it does not touch any other number, and it does not
   * shorten the verify path by a single step.
   */
  describe('reviewer access', () => {
    const REVIEWER = '+6281111111111';
    const withReviewer = (overrides: Record<string, string> = {}) =>
      new OtpService(
        otpRepo,
        delivery,
        crypto,
        clock,
        buildTestConfig({ REVIEWER_PHONE: REVIEWER, REVIEWER_OTP_CODE: '424242', ...overrides }),
      );

    const reviewerCustomer = (): Customer => activeCustomer(REVIEWER);

    it('gives the nominated number the fixed code', async () => {
      await withReviewer().issue(reviewerCustomer(), OtpPurpose.LOGIN);

      expect(otpRepo.rows[0].codeHash).toBe('hashed:424242');
    });

    it('leaves every other number on a random code', async () => {
      await withReviewer().issue(activeCustomer(), OtpPurpose.LOGIN);

      expect(delivery.lastCode).toBe('123456');
    });

    it('does nothing at all when the pair is not configured', async () => {
      await service.issue(reviewerCustomer(), OtpPurpose.LOGIN);

      expect(delivery.lastCode).toBe('123456');
    });

    // Two binaries, two demo accounts: the customer app needs a CUSTOMER, Ops needs a
    // staff role, and one phone holds one role. A single slot would force the two Play
    // reviews to run one after the other.
    it('gives every nominated number the same fixed code', async () => {
      const second = '+6282222222222';
      const many = withReviewer({ REVIEWER_PHONE: `${REVIEWER}, ${second}` });

      // The fake repo keys challenges by customer id and every helper customer shares one,
      // so clear between issues or the resend cooldown answers instead of the code path.
      await many.issue(reviewerCustomer(), OtpPurpose.LOGIN);
      expect(otpRepo.rows[0].codeHash).toBe('hashed:424242');

      otpRepo.rows.length = 0;
      await many.issue(activeCustomer(second), OtpPurpose.LOGIN);
      expect(otpRepo.rows[0].codeHash).toBe('hashed:424242');

      otpRepo.rows.length = 0;
      await many.issue(activeCustomer(), OtpPurpose.LOGIN);
      expect(delivery.lastCode).toBe('123456');
    });

    // The reviewer already knows the code, so sending it costs an SMS and rings a phone
    // that may belong to somebody who never asked — the demo numbers are not always SIMs
    // the company holds. The challenge itself is still created and still verified.
    it('sends no SMS to a nominated number, but still records the challenge', async () => {
      await withReviewer().issue(reviewerCustomer(), OtpPurpose.LOGIN);

      expect(delivery.sent).toHaveLength(0);
      expect(otpRepo.rows[0].codeHash).toBe('hashed:424242');
    });

    it('still delivers to every other number', async () => {
      await withReviewer().issue(activeCustomer(), OtpPurpose.LOGIN);

      expect(delivery.sent).toHaveLength(1);
    });

    it('ignores blank entries rather than matching an empty phone', async () => {
      await withReviewer({ REVIEWER_PHONE: `${REVIEWER},,` }).issue(
        activeCustomer(''),
        OtpPurpose.LOGIN,
      );

      expect(delivery.lastCode).toBe('123456');
    });

    it('does nothing when only one half is set', async () => {
      await withReviewer({ REVIEWER_OTP_CODE: '' }).issue(reviewerCustomer(), OtpPurpose.LOGIN);
      expect(delivery.lastCode).toBe('123456');

      delivery.sent.length = 0;
      otpRepo.rows.length = 0;
      await withReviewer({ REVIEWER_PHONE: '' }).issue(reviewerCustomer(), OtpPurpose.LOGIN);
      expect(delivery.lastCode).toBe('123456');
    });

    it('still expires, still consumes, still counts attempts — the code is fixed, not privileged', async () => {
      const reviewer = withReviewer();
      const customer = reviewerCustomer();
      await reviewer.issue(customer, OtpPurpose.LOGIN);

      // A wrong guess is still a wrong guess.
      await expect(reviewer.verify(customer, OtpPurpose.LOGIN, '000000')).rejects.toBeInstanceOf(
        OtpInvalidError,
      );
      // The right one works once...
      await reviewer.verify(customer, OtpPurpose.LOGIN, '424242');
      // ...and not twice: the challenge is consumed like any other. Consumed is NOT
      // expired (E6 split those) — there is no live challenge left to have a deadline.
      await expect(reviewer.verify(customer, OtpPurpose.LOGIN, '424242')).rejects.toBeInstanceOf(
        OtpInvalidError,
      );
    });

    it('expires on the same clock as everyone else', async () => {
      const reviewer = withReviewer();
      const customer = reviewerCustomer();
      await reviewer.issue(customer, OtpPurpose.LOGIN);

      clock.advance(301);

      await expect(reviewer.verify(customer, OtpPurpose.LOGIN, '424242')).rejects.toBeInstanceOf(
        OtpExpiredError,
      );
    });
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

  // E6: expiry used to answer with OtpInvalidError, so "wrong code" and "too late"
  // arrived under one code and the screen could not tell the customer which.
  it('rejects an expired code', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.LOGIN);
    clock.advance(301);
    await expect(service.verify(customer, OtpPurpose.LOGIN, '123456')).rejects.toBeInstanceOf(
      OtpExpiredError,
    );
  });

  it('rejects verification when no challenge exists', async () => {
    await expect(
      service.verify(activeCustomer(), OtpPurpose.LOGIN, '123456'),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });
  /*
   * Found at runtime: with `OTP_DELIVERY_CHANNEL=sms` and the SMS gateway unreachable,
   * `POST /auth/register` came back as a bare 500 — `TypeError: fetch failed` straight out of
   * the adapter, through AllExceptionsFilter, onto a signup screen that could only say
   * "terjadi kesalahan". The challenge row is already written by then, so the honest answer is
   * "could not send it, try again", not "something broke".
   */
  describe('OtpService — the SMS gateway is down', () => {
    it('refuses with a service-unavailable the caller can act on, not a 500', async () => {
      delivery.shouldFail = true;
      await expect(service.issue(activeCustomer(), OtpPurpose.LOGIN)).rejects.toBeInstanceOf(
        OtpDeliveryUnavailableError,
      );
    });

    it('still stores the challenge, so a retry is a fresh code and not a dead end', async () => {
      delivery.shouldFail = true;
      await expect(service.issue(activeCustomer(), OtpPurpose.LOGIN)).rejects.toBeInstanceOf(
        OtpDeliveryUnavailableError,
      );
      expect(otpRepo.rows).toHaveLength(1);
    });
  });
});

/**
 * Fase E — what the client could not know.
 *
 * E4 the resend cooldown was a number the client held a second copy of, and the two
 *    copies disagreed (30 against 60), so the first honest resend was always refused.
 *    A challenge now states the rule it was issued under.
 * E6 "invalid" and "expired" shared one code, so the screen could not tell a customer
 *    which of the two happened without reading English prose.
 */
describe('OtpService · Fase E', () => {
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

  it('E4 · states the cooldown it will enforce on the challenge it issues', async () => {
    const result = await service.issue(activeCustomer(), OtpPurpose.LOGIN);
    expect(result.resendCooldownSeconds).toBe(buildTestConfig().otpPolicy.resendCooldownSeconds);
  });

  it('E4 · the number it states is the number it actually refuses on', async () => {
    // The SAME customer throughout: a cooldown is per account, so a fresh fixture on each
    // call would make this pass without testing anything.
    const customer = activeCustomer();
    const { resendCooldownSeconds } = await service.issue(customer, OtpPurpose.LOGIN);

    clock.advance(resendCooldownSeconds - 1);
    await expect(service.issue(customer, OtpPurpose.LOGIN)).rejects.toBeInstanceOf(
      OtpResendCooldownError,
    );

    clock.advance(1);
    await expect(service.issue(customer, OtpPurpose.LOGIN)).resolves.toBeDefined();
  });

  it('E6 · an expired code is a different code from a wrong one', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.LOGIN);
    clock.advance(buildTestConfig().otpPolicy.ttlSeconds + 1);

    await expect(
      service.verify(customer, OtpPurpose.LOGIN, delivery.lastCode ?? '000000'),
    ).rejects.toMatchObject({ code: 'AUTH_OTP_EXPIRED' });
  });

  it('E6 · a wrong code is still AUTH_OTP_INVALID', async () => {
    const customer = activeCustomer();
    await service.issue(customer, OtpPurpose.LOGIN);

    await expect(service.verify(customer, OtpPurpose.LOGIN, '999999')).rejects.toMatchObject({
      code: 'AUTH_OTP_INVALID',
    });
  });

  /*
   * The 60-second resend cooldown must not be held against a customer who never got a
   * code — and must not throw away a code that is already on their phone.
   *
   * The challenge is stored BEFORE the send, so what happens to it when the send fails
   * decides whether the customer can try again. Those are two different answers, and
   * before this they were the same one.
   */
  describe('what a failed delivery does to the stored challenge', () => {
    it('clears it when the gateway REJECTED the send, so a resend works at once', async () => {
      const customer = activeCustomer();
      delivery.shouldFail = true;
      delivery.failMode = 'rejected';
      await expect(service.issue(customer, OtpPurpose.LOGIN)).rejects.toBeInstanceOf(
        OtpDeliveryUnavailableError,
      );

      // No cooldown: nothing was sent, so the customer may ask again immediately.
      delivery.shouldFail = false;
      const second = await service.issue(customer, OtpPurpose.LOGIN);
      expect(second.phoneMasked).toBeDefined();
      expect(delivery.sent).toHaveLength(1);
    });

    it('SUCCEEDS when the gateway did not answer, flagging that delivery is still in flight', async () => {
      const customer = activeCustomer();
      delivery.shouldFail = true;
      delivery.failMode = 'unreachable';

      // No throw. The challenge is stored and the code is probably arriving, so the caller
      // goes to the code screen — which is where the code they are about to receive is
      // typed. Telling them it failed while their phone buzzes is the bug being fixed.
      const first = await service.issue(customer, OtpPurpose.LOGIN);
      expect(first.deliveryPending).toBe(true);
      expect(first.phoneMasked).toBeDefined();

      // The challenge survived, so the cooldown still applies — that is what says "wait"
      // rather than "try again", and it is why the code on the phone still verifies.
      delivery.shouldFail = false;
      await expect(service.issue(customer, OtpPurpose.LOGIN)).rejects.toBeInstanceOf(
        OtpResendCooldownError,
      );
    });

    // An adapter can throw something that is not an Error. The log line renders it either
    // way, and a thrown string must not become a crash on a missing `.message`.
    it('survives a delivery that throws something that is not an Error', async () => {
      const customer = activeCustomer();
      delivery.shouldFail = true;
      delivery.failMode = 'raw';
      const result = await service.issue(customer, OtpPurpose.LOGIN);
      expect(result.deliveryPending).toBe(true);
    });

    it('does not flag delivery as pending on the ordinary happy path', async () => {
      const result = await service.issue(activeCustomer(), OtpPurpose.LOGIN);
      expect(result.deliveryPending ?? false).toBe(false);
    });
  });
});
