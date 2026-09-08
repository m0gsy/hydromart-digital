import { Inject, Injectable } from '@nestjs/common';

import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { Role } from '../../domain/customer/role.enum';
import {
  EmailAlreadyRegisteredError,
  PhoneAlreadyRegisteredError,
} from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { Customer } from '../../domain/customer/customer.entity';
import { CustomerRepository } from '../ports/customer.repository';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult, RequestContext } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { ConsentService } from './consent.service';
import { OtpService } from './otp.service';

export interface RegisterCommand {
  phone: string;
  fullName?: string;
  email?: string;
  /** Optional marketing opt-in ticked at signup. Absent = never asked, not refused. */
  marketingConsent?: boolean;
  context: RequestContext;
}

/**
 * Phone-first registration (FR-001). Creates a pending account and issues a
 * verification OTP. Re-registering a phone that is still pending simply re-issues
 * the code (idempotent), while an already-active phone is rejected (BR-001).
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly consents: ConsentService,
  ) {}

  async register(command: RegisterCommand): Promise<OtpChallengeResult> {
    const phone = PhoneNumber.create(command.phone).value;
    const email = command.email?.trim().toLowerCase() || null;

    const existing = await this.customers.findByPhone(phone);
    if (existing && existing.status !== CustomerStatus.PENDING_VERIFICATION) {
      throw new PhoneAlreadyRegisteredError();
    }

    if (email) {
      const emailOwner = await this.customers.findByEmail(email);
      if (emailOwner && emailOwner.phone !== phone) {
        throw new EmailAlreadyRegisteredError();
      }
    }

    const fullName = command.fullName?.trim() || null;

    /*
     * CA-3-38 — a second attempt on a still-pending number threw away what was typed.
     *
     * The row already exists (status PENDING_VERIFICATION), so `existing` was reused
     * as-is and the new `fullName` and `email` were dropped on the floor. The path this
     * matters on is the ordinary one: somebody mistypes their name or their email, never
     * gets the code, and fills the form in again correctly. They were then verified under
     * the wrong details, with nothing on screen to say the correction had been ignored —
     * and the email in particular is a login identifier.
     *
     * Only what the caller actually supplied is written. A second attempt that leaves the
     * optional email blank must not erase the address given on the first one; that is a
     * deletion nobody asked for, and `updateProfile` treats `undefined` and `null`
     * differently for exactly this reason.
     */
    let customer: Customer;
    if (existing) {
      existing.updateProfile(fullName ?? undefined, email ?? undefined);
      customer = await this.customers.save(existing);
    } else {
      customer = await this.customers.create({
        phone,
        email,
        fullName,
        role: Role.CUSTOMER,
      });
    }

    // UU PDP tahap 2: the signup checkbox becomes a ledger row. Only for a NEW account —
    // re-issuing an OTP to a pending signup must not stack duplicate consent rows.
    if (!existing) {
      await this.consents.recordRegistrationConsent(customer.id, command.marketingConsent === true);
    }

    const challenge = await this.otp.issue(customer, OtpPurpose.REGISTRATION);

    await this.audit.record({
      customerId: customer.id,
      action: AuditAction.REGISTER_REQUESTED,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
    });

    return challenge;
  }
}
