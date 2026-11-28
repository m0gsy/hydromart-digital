import { Inject, Injectable } from '@nestjs/common';

import { SessionDropReason } from '../../domain/session-drop';
import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { NotStaffError, StaffAccountError } from '../../domain/errors/auth.errors';
import { Role } from '../../domain/customer/role.enum';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerRepository } from '../ports/customer.repository';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult, RequestContext } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';

export interface LoginRequestCommand {
  phone: string;
  /**
   * Which app is asking. 'STAFF' (a staff-only door): a number that is no staff login is refused,
   * never registered. 'CUSTOMER' (the customer app): a staff login is refused, sent to Ops.
   */
  audience?: 'STAFF' | 'CUSTOMER';
  /** HD-8: campaign codes, kept only when this request signs a new number up. */
  firstSource?: string;
  lastSource?: string;
  /** Native app: why it dropped a still-valid session (audit metadata only). */
  sessionDrop?: SessionDropReason;
  /** Sanitised x-app-id / x-app-version of the calling app build. */
  appId?: string;
  appVersion?: string;
  context: RequestContext;
}

/**
 * Login flow: phone (FR-005, OTP challenge). (Google Sign-In was removed — phone/OTP
 * is the sole path.)
 */
@Injectable()
export class LoginService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Begin a phone login by issuing an OTP challenge.
   *
   * AUTH-3 — this used to answer 404 `AUTH_CUSTOMER_NOT_FOUND` for a number with no
   * account. That is an enumeration oracle anybody could run: post a number, read the
   * status, learn whether that person banks here — and a phone number identifies a person
   * far more precisely than an email address does.
   *
   * So there is one door now. A number with no account is pre-registered exactly as
   * `/auth/register` would (PENDING_VERIFICATION, no name, no email) and gets a
   * REGISTRATION code; a number half-way through signup gets the same; an active account
   * gets its LOGIN code. Every answer has the same shape, and the client is told which code
   * it is holding rather than inferring it from an error.
   *
   * This widens nothing that `/auth/register` did not already offer: that route has always
   * issued a code to any number a caller names, and the gateway's OTP tier rate-limits both.
   *
   * SUSPENDED and DELETED still refuse, deliberately. Those are accounts whose owner needs
   * to be told something specific, and silently issuing codes nobody can use would make a
   * support call unanswerable. They are also not the enumeration surface: reaching that
   * state requires an account to have existed and been acted on by staff.
   *
   * The staff doors (`audience: 'STAFF'`) are the exception, by owner decision 2026-11-20.
   * Signing an unknown number up there put staff whose HR record had a wrong number into the
   * shop as customers, and the customer account then blocked HR's correction. So a number
   * that is not a staff login is refused there and nothing is created. That door does tell a
   * caller whether a number is a STAFF login — accepted, rate-limited like every OTP route —
   * while a customer number and an unknown one still answer identically.
   *
   * The customer app (`audience: 'CUSTOMER'`) refuses the other way round: a staff login is sent
   * to the Ops app, because the customer binary carries none of the consoles it would land on.
   */
  async requestLogin(command: LoginRequestCommand): Promise<OtpChallengeResult> {
    const phone = PhoneNumber.create(command.phone).value;
    const existing = await this.customers.findByPhone(phone);
    if (command.audience === 'STAFF' && (!existing || existing.role === Role.CUSTOMER)) {
      throw new NotStaffError();
    }
    if (command.audience === 'CUSTOMER' && existing && existing.role !== Role.CUSTOMER) {
      throw new StaffAccountError();
    }
    // HD-8: a new number signs up here as on /register, with the same campaign codes, both or
    // neither. A number that already has an account keeps the codes it signed up with.
    const customer =
      existing ??
      (await this.customers.create({
        phone,
        email: null,
        fullName: null,
        role: Role.CUSTOMER,
        firstSource: command.firstSource ?? command.lastSource ?? null,
        lastSource: command.lastSource ?? command.firstSource ?? null,
      }));

    const registering = customer.status === CustomerStatus.PENDING_VERIFICATION;
    if (!registering) customer.ensureCanAuthenticate();

    const challenge = await this.otp.issue(
      customer,
      registering ? OtpPurpose.REGISTRATION : OtpPurpose.LOGIN,
    );

    const metadata = {
      ...(command.sessionDrop ? { sessionDrop: command.sessionDrop } : {}),
      ...(command.appId ? { appId: command.appId } : {}),
      ...(command.appVersion ? { appVersion: command.appVersion } : {}),
    };
    await this.audit.record({
      customerId: customer.id,
      action: registering ? AuditAction.REGISTER_REQUESTED : AuditAction.LOGIN_REQUESTED,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });

    return challenge;
  }
}
