import { Inject, Injectable } from '@nestjs/common';

import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { Role } from '../../domain/customer/role.enum';
import {
  EmailAlreadyRegisteredError,
  PhoneAlreadyRegisteredError,
} from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerRepository } from '../ports/customer.repository';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult, RequestContext } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';

export interface RegisterCommand {
  phone: string;
  fullName?: string;
  email?: string;
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

    const customer =
      existing ??
      (await this.customers.create({
        phone,
        email,
        fullName: command.fullName?.trim() || null,
        role: Role.CUSTOMER,
      }));

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
