import { Inject, Injectable } from '@nestjs/common';

import {
  CustomerNotFoundError,
  NoPendingPhoneChangeError,
  PhoneAlreadyRegisteredError,
  PhoneUnchangedError,
} from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerNotificationPort } from '../ports/customer-notification.port';
import { CustomerRepository } from '../ports/customer.repository';
import { OtpTokenRepository } from '../ports/otp-token.repository';
import { OtpChallengeResult, PublicCustomer, RequestContext, toPublicCustomer } from '../results';
import { AUTH_TOKENS } from '../tokens';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

/**
 * K1.4 — the phone number becomes changeable.
 *
 * It is the login identity and the whole of it: there is no password, so whoever receives
 * the OTP on that number IS the account. And it could not be changed anywhere — not on
 * `/account/edit`, not in the app, not by the customer at all. Somebody who changes SIM,
 * loses a number, or mistypes one digit at sign-up had exactly one route back into their
 * own account, and it went through a depot.
 *
 * Two steps, because moving an identity on one request is the same shape as stealing one:
 *
 *   request   the caller is already signed in as this account, so they hold the OLD
 *             number. A code goes to the NEW one and nothing moves yet.
 *   confirm   the code proves control of the new number too. Only now does the account
 *             move, and only onto the number the code was actually delivered to — read
 *             back off the challenge, never off the request body.
 *
 * Every session is revoked on success — including the one that asked. A session opened
 * before the identity moved was opened by whoever held the OLD number, and nothing here
 * can tell which of them is the person standing at the screen. It also makes the change
 * self-verifying: the next sign-in has to succeed on the new number, immediately, in front
 * of the person who asked for it.
 */
@Injectable()
export class PhoneChangeService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.OtpTokenRepository) private readonly otpTokens: OtpTokenRepository,
    @Inject(AUTH_TOKENS.CustomerNotificationPort)
    private readonly notifications: CustomerNotificationPort,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Send a code to the number the caller wants to move to. Nothing about the account
   * changes here — a request that is never confirmed leaves no trace but an audit row,
   * which is exactly what a failed hijack attempt should leave.
   */
  async request(
    customerId: string,
    newPhone: string,
    context: RequestContext,
  ): Promise<OtpChallengeResult> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    const phone = PhoneNumber.create(newPhone).value;
    if (phone === customer.phone) {
      throw new PhoneUnchangedError();
    }
    // Checked here so the caller learns before spending an SMS, and again at confirm
    // because somebody else can register it in between.
    const owner = await this.customers.findByPhone(phone);
    if (owner) {
      throw new PhoneAlreadyRegisteredError();
    }

    const challenge = await this.otp.issue(customer, OtpPurpose.PHONE_CHANGE, phone);

    await this.audit.record({
      customerId,
      action: AuditAction.PHONE_CHANGE_REQUESTED,
      success: true,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      // Masked: this table is read by staff, and a phone number is the identity itself.
      metadata: { newPhone: OtpService.maskPhone(phone) },
    });

    return challenge;
  }

  /**
   * Spend the code and move the account.
   *
   * The destination comes off the stored challenge, not from the caller. That is the whole
   * safety property: a code proves control of wherever it was delivered, so accepting a
   * number from the request body would let one proof move the account somewhere else.
   */
  async confirm(
    customerId: string,
    code: string,
    context: RequestContext,
  ): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }

    const pending = await this.otpTokens.findActive(customerId, OtpPurpose.PHONE_CHANGE);
    if (!pending?.targetPhone) {
      throw new NoPendingPhoneChangeError();
    }
    const target = pending.targetPhone;

    try {
      await this.otp.verify(customer, OtpPurpose.PHONE_CHANGE, code);
    } catch (error) {
      await this.audit.record({
        customerId,
        action: AuditAction.OTP_FAILED,
        success: false,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { purpose: OtpPurpose.PHONE_CHANGE, reason: (error as Error).name },
      });
      throw error;
    }

    // Re-checked after the code is spent, because the window between request and confirm
    // is minutes long and a registration can land inside it. The repository's unique
    // constraint closes the last of the race; this turns it into the same 409 the request
    // step gives rather than a 500.
    const owner = await this.customers.findByPhone(target);
    if (owner && owner.id !== customerId) {
      throw new PhoneAlreadyRegisteredError();
    }

    const oldPhone = customer.phone;
    customer.changePhone(target);
    const saved = await this.customers.save(customer);

    // Every session, including the one making this request. A session opened before the
    // identity moved was opened by whoever held the OLD number, and there is no way from
    // here to tell which of them is the person standing here now. Signing everybody out
    // also makes the change self-verifying: the next sign-in has to succeed on the new
    // number, in front of the person who asked for it.
    await this.sessions.revokeAll(customerId);

    await this.audit.record({
      customerId,
      action: AuditAction.PHONE_CHANGED,
      success: true,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        from: OtpService.maskPhone(oldPhone),
        to: OtpService.maskPhone(target),
      },
    });

    // The only warning a stolen change produces. Fail-open: the change is already made and
    // already proved, and a messaging outage must not undo it.
    await this.notifications
      .sendPhoneChanged(oldPhone, OtpService.maskPhone(target), saved.fullName ?? 'Pelanggan')
      .catch(() => undefined);

    return toPublicCustomer(saved);
  }
}
