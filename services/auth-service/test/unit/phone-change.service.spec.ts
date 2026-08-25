import {
  CustomerNotFoundError,
  NoPendingPhoneChangeError,
  OtpInvalidError,
  PhoneAlreadyRegisteredError,
  PhoneUnchangedError,
} from '../../src/domain/errors/auth.errors';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { OtpService } from '../../src/application/services/otp.service';
import { PhoneChangeService } from '../../src/application/services/phone-change.service';
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

class FakeCustomerNotification {
  readonly welcomed: { phone: string; name: string }[] = [];
  readonly phoneChanges: { oldPhone: string; newPhoneMasked: string; name: string }[] = [];
  async sendWelcome(phone: string, name: string): Promise<void> {
    this.welcomed.push({ phone, name });
  }
  async sendPhoneChanged(oldPhone: string, newPhoneMasked: string, name: string): Promise<void> {
    this.phoneChanges.push({ oldPhone, newPhoneMasked, name });
  }
}

/**
 * K1.4. The phone number is the login identity and the whole of it — there is no password,
 * so whoever receives the OTP on that number IS the account. It could not be changed
 * anywhere, and moving one on a single request is the same shape as stealing one. Every
 * case here is about one of those two facts.
 */
describe('PhoneChangeService', () => {
  const OLD = '+6281234567890';
  const NEW = '+6289876543210';
  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  let customers: InMemoryCustomerRepository;
  let otpTokens: InMemoryOtpTokenRepository;
  let audit: InMemoryAuditLogRepository;
  let delivery: FakeOtpDelivery;
  let notifications: FakeCustomerNotification;
  let refreshTokens: InMemoryRefreshTokenRepository;
  let sessions: SessionService;
  let service: PhoneChangeService;
  let customerId: string;

  beforeEach(async () => {
    customers = new InMemoryCustomerRepository();
    otpTokens = new InMemoryOtpTokenRepository();
    audit = new InMemoryAuditLogRepository();
    delivery = new FakeOtpDelivery();
    notifications = new FakeCustomerNotification();
    const clock = new FakeClock();
    const crypto = new FakeCrypto();
    const config = buildTestConfig();
    const otp = new OtpService(otpTokens, delivery, crypto, clock, config);
    refreshTokens = new InMemoryRefreshTokenRepository();
    sessions = new SessionService(
      refreshTokens,
      customers,
      new FakeAccessTokenSigner(),
      crypto,
      clock,
      config,
    );
    service = new PhoneChangeService(
      customers,
      otpTokens,
      notifications as never,
      otp,
      sessions,
      new AuditService(audit),
    );

    const saved = await customers.save(makeCustomer({ phone: OLD, fullName: 'Budi' }));
    customerId = saved.id;
  });

  /** Runs the request step and hands back the code that was actually delivered. */
  async function requestChange(to = NEW): Promise<string> {
    await service.request(customerId, to, ctx);
    return delivery.lastCode!;
  }

  describe('request', () => {
    it('sends the code to the NEW number, not the one already on the account', async () => {
      await service.request(customerId, NEW, ctx);

      expect(delivery.sent).toHaveLength(1);
      expect(delivery.sent[0]!.phone).toBe(NEW);
      expect(delivery.sent[0]!.purpose).toBe(OtpPurpose.PHONE_CHANGE);
    });

    it('records where the code went, because confirm has to read it back', async () => {
      await service.request(customerId, NEW, ctx);

      const pending = await otpTokens.findActive(customerId, OtpPurpose.PHONE_CHANGE);
      expect(pending?.targetPhone).toBe(NEW);
    });

    it('changes nothing about the account yet', async () => {
      await service.request(customerId, NEW, ctx);

      expect((await customers.findById(customerId))!.phone).toBe(OLD);
    });

    it('leaves an audit row with the destination MASKED', async () => {
      await service.request(customerId, NEW, ctx);

      const row = audit.entries.find((r) => r.action === AuditAction.PHONE_CHANGE_REQUESTED);
      expect(row).toBeDefined();
      expect(row!.metadata).toEqual({ newPhone: OtpService.maskPhone(NEW) });
      // The number itself must not be in the trail: this table is read by staff.
      expect(JSON.stringify(row!.metadata)).not.toContain(NEW);
    });

    it('refuses a number that already belongs to somebody, before spending an SMS', async () => {
      await customers.save(makeCustomer({ phone: NEW }));

      await expect(service.request(customerId, NEW, ctx)).rejects.toBeInstanceOf(
        PhoneAlreadyRegisteredError,
      );
      expect(delivery.sent).toHaveLength(0);
    });

    it('refuses the number the account already has', async () => {
      await expect(service.request(customerId, OLD, ctx)).rejects.toBeInstanceOf(
        PhoneUnchangedError,
      );
      expect(delivery.sent).toHaveLength(0);
    });
  });

  describe('confirm', () => {
    it('moves the account onto the number the code was delivered to', async () => {
      const code = await requestChange();

      const profile = await service.confirm(customerId, code, ctx);

      expect(profile.phone).toBe(NEW);
      expect((await customers.findById(customerId))!.phone).toBe(NEW);
    });

    /*
     * The safety property this whole design exists for. A code proves control of wherever
     * it was DELIVERED; if the destination came from the request body, one proof could
     * move the account somewhere else entirely. The confirm DTO carries no phone at all,
     * and this is the case that says the service does not read one either.
     */
    it('ignores any number the caller might supply and uses the stored destination', async () => {
      const code = await requestChange(NEW);

      // Whatever a caller sends, the only input this method takes is the code.
      const profile = await service.confirm(customerId, code, ctx);

      expect(profile.phone).toBe(NEW);
    });

    it('refuses a wrong code and leaves the number alone', async () => {
      await requestChange();

      await expect(service.confirm(customerId, '000000', ctx)).rejects.toBeInstanceOf(
        OtpInvalidError,
      );
      expect((await customers.findById(customerId))!.phone).toBe(OLD);
      expect(audit.entries.some((r) => r.action === AuditAction.OTP_FAILED)).toBe(true);
    });

    it('says plainly that nothing was requested rather than "wrong code"', async () => {
      // The caller is already authenticated as this account, so there is nothing to hide —
      // and "wrong code" would leave somebody retyping a code that could never work.
      await expect(service.confirm(customerId, '123456', ctx)).rejects.toBeInstanceOf(
        NoPendingPhoneChangeError,
      );
    });

    it('cannot be spent twice', async () => {
      const code = await requestChange();
      await service.confirm(customerId, code, ctx);

      await expect(service.confirm(customerId, code, ctx)).rejects.toBeInstanceOf(
        NoPendingPhoneChangeError,
      );
    });

    it('refuses when somebody registered that number during the window', async () => {
      const code = await requestChange();
      // The gap between request and confirm is minutes long, and a registration fits in it.
      await customers.save(makeCustomer({ phone: NEW }));

      await expect(service.confirm(customerId, code, ctx)).rejects.toBeInstanceOf(
        PhoneAlreadyRegisteredError,
      );
      expect((await customers.findById(customerId))!.phone).toBe(OLD);
    });

    it('signs every session out, including the one that asked', async () => {
      const customer = (await customers.findById(customerId))!;
      await sessions.issueForCustomer(customer, ctx);
      await sessions.issueForCustomer(customer, ctx);
      expect(await sessions.listActive(customerId)).toHaveLength(2);

      const code = await requestChange();
      await service.confirm(customerId, code, ctx);

      expect(await sessions.listActive(customerId)).toHaveLength(0);
    });

    it('warns the OLD number, which is the only trace a hijack leaves', async () => {
      const code = await requestChange();

      await service.confirm(customerId, code, ctx);

      expect(notifications.phoneChanges).toEqual([
        { oldPhone: OLD, newPhoneMasked: OtpService.maskPhone(NEW), name: 'Budi' },
      ]);
    });

    it('records the change with BOTH numbers masked', async () => {
      const code = await requestChange();

      await service.confirm(customerId, code, ctx);

      const row = audit.entries.find((r) => r.action === AuditAction.PHONE_CHANGED);
      expect(row!.metadata).toEqual({
        from: OtpService.maskPhone(OLD),
        to: OtpService.maskPhone(NEW),
      });
    });
  });

  describe('an account that is not there', () => {
    // Reachable in one real way: a session outliving a PDP deletion, whose account row is
    // gone while the token in the caller's hand still parses.
    it('refuses the request', async () => {
      await expect(service.request('missing', NEW, ctx)).rejects.toBeInstanceOf(
        CustomerNotFoundError,
      );
    });

    it('refuses the confirm', async () => {
      await expect(service.confirm('missing', '123456', ctx)).rejects.toBeInstanceOf(
        CustomerNotFoundError,
      );
    });
  });

  describe('the warning is best-effort, the change is not', () => {
    it('still moves the number when the warning cannot be delivered', async () => {
      const code = await requestChange();
      notifications.sendPhoneChanged = async () => {
        throw new Error('crm down');
      };

      await expect(service.confirm(customerId, code, ctx)).resolves.toMatchObject({ phone: NEW });
      expect((await customers.findById(customerId))!.phone).toBe(NEW);
    });

    it('addresses an account with no name on it without saying "undefined"', async () => {
      const nameless = await customers.save(makeCustomer({ phone: '+6281111111111', fullName: null }));
      await service.request(nameless.id, NEW, ctx);

      await service.confirm(nameless.id, delivery.lastCode!, ctx);

      expect(notifications.phoneChanges[0]!.name).toBe('Pelanggan');
    });
  });
});
