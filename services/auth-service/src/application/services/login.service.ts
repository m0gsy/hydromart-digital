import { Inject, Injectable } from '@nestjs/common';

import { CustomerNotFoundError } from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerRepository } from '../ports/customer.repository';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult, RequestContext } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';

export interface LoginRequestCommand {
  phone: string;
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

  /** Begin a phone login by issuing an OTP challenge. */
  async requestLogin(command: LoginRequestCommand): Promise<OtpChallengeResult> {
    const phone = PhoneNumber.create(command.phone).value;
    const customer = await this.customers.findByPhone(phone);
    if (!customer) {
      throw new CustomerNotFoundError('No account is registered with this phone number.');
    }
    customer.ensureCanAuthenticate();

    const challenge = await this.otp.issue(customer, OtpPurpose.LOGIN);

    await this.audit.record({
      customerId: customer.id,
      action: AuditAction.LOGIN_REQUESTED,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
    });

    return challenge;
  }
}
