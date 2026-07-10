import { Inject, Injectable } from '@nestjs/common';

import { CustomerNotFoundError, OtpInvalidError } from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { ClockPort } from '../ports/clock.port';
import { CustomerNotificationPort } from '../ports/customer-notification.port';
import { CustomerRepository } from '../ports/customer.repository';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult, RequestContext, SessionResult } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

export interface VerifyOtpCommand {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  context: RequestContext;
}

export interface ResendOtpCommand {
  phone: string;
  purpose: OtpPurpose;
  context: RequestContext;
}

/**
 * Verifies an OTP and, on success, activates the account (for registration) and
 * issues a session (FR-003/004). Also handles code resend (FR-002).
 */
@Injectable()
export class OtpVerificationService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
    @Inject(AUTH_TOKENS.CustomerNotificationPort)
    private readonly notifications: CustomerNotificationPort,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async verify(command: VerifyOtpCommand): Promise<SessionResult> {
    const phone = PhoneNumber.create(command.phone).value;
    const customer = await this.customers.findByPhone(phone);
    // Do not disclose whether the phone exists — generic invalid-code error.
    if (!customer) {
      throw new OtpInvalidError();
    }

    try {
      await this.otp.verify(customer, command.purpose, command.code);
    } catch (error) {
      await this.audit.record({
        customerId: customer.id,
        action: AuditAction.OTP_FAILED,
        success: false,
        ipAddress: command.context.ipAddress,
        userAgent: command.context.userAgent,
        metadata: { purpose: command.purpose, reason: (error as Error).name },
      });
      throw error;
    }

    const now = this.clock.now();
    const isRegistration = command.purpose === OtpPurpose.REGISTRATION;
    if (isRegistration) {
      customer.markPhoneVerified(now);
    }
    customer.ensureCanAuthenticate();
    customer.recordLogin(now);
    const saved = await this.customers.save(customer);

    // Welcome the new customer. Fail-open: the adapter never throws, but guard the
    // call anyway so notification wiring can never break the verification flow.
    if (isRegistration) {
      await this.notifications
        .sendWelcome(saved.phone, saved.fullName ?? 'Pelanggan')
        .catch(() => undefined);
    }

    const session = await this.sessions.issueForCustomer(saved, command.context);

    await this.audit.record({
      customerId: saved.id,
      action: AuditAction.OTP_VERIFIED,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
      metadata: { purpose: command.purpose },
    });
    await this.audit.record({
      customerId: saved.id,
      action: AuditAction.LOGIN_SUCCEEDED,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
    });

    return session;
  }

  async resend(command: ResendOtpCommand): Promise<OtpChallengeResult> {
    const phone = PhoneNumber.create(command.phone).value;
    const customer = await this.customers.findByPhone(phone);
    if (!customer) {
      throw new CustomerNotFoundError('No account is registered with this phone number.');
    }

    const challenge = await this.otp.issue(customer, command.purpose);

    await this.audit.record({
      customerId: customer.id,
      action: AuditAction.OTP_RESENT,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
      metadata: { purpose: command.purpose },
    });

    return challenge;
  }
}
