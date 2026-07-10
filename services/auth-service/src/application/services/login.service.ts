import { Inject, Injectable } from '@nestjs/common';

import { CustomerNotFoundError } from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { ClockPort } from '../ports/clock.port';
import { CustomerRepository } from '../ports/customer.repository';
import { GoogleVerifierPort } from '../ports/google-verifier.port';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult, RequestContext, SessionResult } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';

export interface LoginRequestCommand {
  phone: string;
  context: RequestContext;
}

export interface GoogleSignInCommand {
  idToken: string;
  context: RequestContext;
}

/**
 * Login flows: phone (FR-005, OTP challenge) and Google Sign-In (FR-006, direct
 * session). Google Sign-In links to an existing account (matched by Google subject
 * or verified email); it does not create phone-less accounts, since a phone number
 * is mandatory for delivery (documented assumption).
 */
@Injectable()
export class LoginService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.GoogleVerifierPort) private readonly google: GoogleVerifierPort,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
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

  /** Complete Google Sign-In and issue a session immediately. */
  async googleSignIn(command: GoogleSignInCommand): Promise<SessionResult> {
    const identity = await this.google.verify(command.idToken);

    let customer = await this.customers.findByGoogleSub(identity.sub);
    if (!customer && identity.email && identity.emailVerified) {
      customer = await this.customers.findByEmail(identity.email);
    }

    if (!customer) {
      throw new CustomerNotFoundError(
        'No Hydromart account is linked to this Google account. Please register with your phone number first.',
      );
    }

    customer.ensureCanAuthenticate();
    customer.linkGoogle(identity.sub, identity.email, identity.name);
    customer.recordLogin(this.clock.now());
    const saved = await this.customers.save(customer);

    const session = await this.sessions.issueForCustomer(saved, command.context);

    await this.audit.record({
      customerId: saved.id,
      action: AuditAction.GOOGLE_SIGNIN,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
    });

    return session;
  }
}
