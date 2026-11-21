import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuthConfigService } from '../../config/auth-config.service';
import { Customer } from '../../domain/customer/customer.entity';
import { Role } from '../../domain/customer/role.enum';
import {
  CustomerNotFoundError,
  HandoffNotForCustomersError,
  InvalidTotpCodeError,
  TotpAlreadyEnrolledError,
  TotpEnrolmentRequiredError,
  TotpLockedError,
  TotpNotStartedError,
  TotpOffError,
  TotpResetForbiddenError,
} from '../../domain/errors/auth.errors';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import {
  base32,
  matchStep,
  newRecoveryCodes,
  recoveryCodeHash,
  sealSecret,
  signTicket,
  ticketValid,
  TotpKeys,
  unsealSecret,
} from '../../infrastructure/security/totp';
import { ClockPort } from '../ports/clock.port';
import { CustomerRepository } from '../ports/customer.repository';
import { TotpCredentialRecord, TotpRepository } from '../ports/totp.repository';
import { OtpChallengeResult, RequestContext } from '../results';
import { AUTH_TOKENS } from '../tokens';
import { AuditAction, AuditService } from './audit.service';
import { OtpService } from './otp.service';

/** Plan Eksekusi section 4: Direksi, HQ, Finance and SUPER_ADMIN give a second factor. */
export const TOTP_REQUIRED_ROLES: ReadonlySet<string> = new Set([
  Role.DIREKTUR,
  Role.HEAD_OFFICE,
  Role.FINANCE,
  Role.SUPER_ADMIN,
]);
export const MAX_TOTP_FAILURES = 5;
export const TOTP_LOCK_SECONDS = 15 * 60;
/**
 * "Once per session": a passed step is good for this long. The AI web keeps the ticket in
 * its server-side session and sends it with each automatic re-handoff instead of a code.
 */
export const SECOND_FACTOR_TICKET_TTL_SECONDS = 12 * 60 * 60;
const ISSUER = 'HYDROMART';

type Caller = { sub: string; role: string };
type Step = 'enrolment' | 'handoff';

export interface SecondFactor {
  totp?: string;
  recoveryCode?: string;
  ticket?: string;
}

export type HandoffSecondFactor =
  | { kind: 'not-needed' }
  | { kind: 'missing' }
  | { kind: 'ticket' }
  | { kind: 'totp' | 'recovery'; ticket: string; ticketExpiresIn: number };

export interface TotpStatus {
  /** False while TOTP_ENCRYPTION_KEY is blank: nothing can be set up yet. */
  available: boolean;
  /** This role must pass the step to sign in to the AI web. */
  required: boolean;
  enrolled: boolean;
  recoveryCodesLeft: number;
  lockedUntil: string | null;
}

/**
 * HD-4: the authenticator app (TOTP) that Direksi, HQ, Finance and SUPER_ADMIN use as the
 * second factor of the AI-web sign-in. Set up from the person's own hydromart-digital
 * session plus an SMS code to their number; checked at the handoff exchange; reset only by
 * another SUPER_ADMIN. Anyone else who chose to set one up is held to it too, so an
 * enrolment can never be walked around.
 */
@Injectable()
export class TotpService {
  constructor(
    @Inject(AUTH_TOKENS.TotpRepository) private readonly totp: TotpRepository,
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
    private readonly audit: AuditService,
    private readonly config: AuthConfigService,
    private readonly otp: OtpService,
  ) {}

  async status(caller: Caller): Promise<TotpStatus> {
    const credential = await this.totp.find(caller.sub);
    const enrolled = Boolean(credential?.confirmedAt);
    const lockedUntil = credential?.lockedUntil;
    return {
      available: this.config.totpKeys !== null,
      required: TOTP_REQUIRED_ROLES.has(caller.role),
      enrolled,
      recoveryCodesLeft: enrolled ? await this.totp.countRecoveryCodesLeft(caller.sub) : 0,
      lockedUntil: lockedUntil && lockedUntil > this.clock.now() ? lockedUntil.toISOString() : null,
    };
  }

  /**
   * A new secret for the person's app, shown once, and an SMS code to the account's own
   * number. A session alone cannot bind an app: the confirm step needs both codes.
   */
  async startEnrolment(
    caller: Caller,
    context: RequestContext,
  ): Promise<{ secret: string; otpauthUri: string; sms: OtpChallengeResult }> {
    const keys = this.keys();
    if (caller.role === Role.CUSTOMER) throw new HandoffNotForCustomersError();
    const customer = await this.customers.findById(caller.sub);
    if (!customer) throw new CustomerNotFoundError();
    // Checked before the SMS is paid for; startEnrolment below is what holds under a race.
    if ((await this.totp.find(customer.id))?.confirmedAt) throw new TotpAlreadyEnrolledError();

    const sms = await this.otp.issue(customer, OtpPurpose.TOTP_ENROLMENT);
    const secret = randomBytes(20);
    const started = await this.totp.startEnrolment(
      customer.id,
      sealSecret(keys.seal, secret, customer.id),
    );
    if (!started) throw new TotpAlreadyEnrolledError();
    await this.audit.record({
      customerId: customer.id,
      action: AuditAction.TOTP_ENROLMENT_STARTED,
      success: true,
      ...context,
    });
    const encoded = base32(secret);
    const label = encodeURIComponent(`${ISSUER}:${customer.phone}`);
    return {
      secret: encoded,
      otpauthUri: `otpauth://totp/${label}?secret=${encoded}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=30`,
      sms,
    };
  }

  /**
   * The first code from the app proves it holds the secret; the SMS code proves the phone.
   * The app code is checked first, so a typo in it does not spend the SMS code. The
   * recovery codes come back once.
   */
  async confirmEnrolment(
    caller: Caller,
    code: string,
    smsCode: string,
    context: RequestContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const keys = this.keys();
    const credential = await this.totp.find(caller.sub);
    if (!credential) throw new TotpNotStartedError();
    if (credential.confirmedAt) throw new TotpAlreadyEnrolledError();
    const customer = await this.customers.findById(caller.sub);
    if (!customer) throw new CustomerNotFoundError();
    const now = this.clock.now();
    const attempt = await this.claimAttempt(credential, 'enrolment', context, now);

    const secret = unsealSecret(keys.seal, credential.secretSealed, caller.sub);
    const step = matchStep(secret, code, now.getTime(), null);
    if (step === null) return this.wrongCode(caller.sub, attempt, 'enrolment', context, now);
    try {
      await this.otp.verify(customer, OtpPurpose.TOTP_ENROLMENT, smsCode);
    } catch (error) {
      await this.audit.record({
        customerId: caller.sub,
        action: AuditAction.OTP_FAILED,
        success: false,
        ...context,
        metadata: { purpose: OtpPurpose.TOTP_ENROLMENT, reason: (error as Error).name },
      });
      throw error;
    }

    const recoveryCodes = newRecoveryCodes();
    const hashes = recoveryCodes.map((c) => recoveryCodeHash(keys.mac, c));
    if (!(await this.totp.confirm(caller.sub, step, now, hashes))) throw new TotpNotStartedError();
    await this.audit.record({
      customerId: caller.sub,
      action: AuditAction.TOTP_ENROLLED,
      success: true,
      ...context,
    });
    return { recoveryCodes };
  }

  /** "Reset oleh SUPER_ADMIN kedua": a SUPER_ADMIN, never on their own account. */
  async reset(caller: Caller, targetId: string, context: RequestContext): Promise<{ removed: boolean }> {
    if (caller.role !== Role.SUPER_ADMIN || caller.sub === targetId) {
      await this.audit.record({
        customerId: caller.sub,
        action: AuditAction.TOTP_RESET,
        success: false,
        ...context,
        metadata: { targetId, reason: caller.sub === targetId ? 'own-account' : 'role' },
      });
      throw new TotpResetForbiddenError();
    }
    if (!(await this.customers.findById(targetId))) throw new CustomerNotFoundError();
    const removed = await this.totp.remove(targetId);
    await this.audit.record({
      customerId: caller.sub,
      action: AuditAction.TOTP_RESET,
      success: true,
      ...context,
      metadata: { targetId, removed },
    });
    return { removed };
  }

  /**
   * The handoff's second factor. Throws when it cannot pass (switched off, not set up,
   * locked, wrong code); `missing` when nothing was sent and the AI web should ask.
   */
  async checkHandoff(
    customer: Customer,
    factor: SecondFactor,
    context: RequestContext,
  ): Promise<HandoffSecondFactor> {
    const found = await this.totp.find(customer.id);
    const credential = found?.confirmedAt ? found : null;
    if (!credential && !TOTP_REQUIRED_ROLES.has(customer.role)) return { kind: 'not-needed' };
    const keys = this.keys();
    if (!credential) throw new TotpEnrolmentRequiredError();
    const now = this.clock.now();

    // A ticket is the proof of an earlier pass, so it is honoured even while guessing has
    // the step locked; it is a 12-hour bearer value the AI web keeps on its server.
    if (
      factor.ticket &&
      ticketValid(
        keys.mac,
        factor.ticket,
        customer.id,
        credential.secretSealed,
        now.getTime(),
        SECOND_FACTOR_TICKET_TTL_SECONDS,
      )
    ) {
      return { kind: 'ticket' };
    }
    if (credential.lockedUntil && credential.lockedUntil > now) {
      return this.refuseLocked(customer.id, credential.lockedUntil, 'handoff', context, now);
    }
    if (!factor.totp && !factor.recoveryCode) return { kind: 'missing' };
    const attempt = await this.claimAttempt(credential, 'handoff', context, now);

    let kind: 'totp' | 'recovery';
    if (factor.totp) {
      const secret = unsealSecret(keys.seal, credential.secretSealed, customer.id);
      const step = matchStep(secret, factor.totp, now.getTime(), credential.lastStep);
      // acceptStep is the replay guard: two requests with one code, only one wins.
      if (step === null || !(await this.totp.acceptStep(customer.id, step))) {
        return this.wrongCode(customer.id, attempt, 'handoff', context, now);
      }
      kind = 'totp';
    } else {
      const hash = recoveryCodeHash(keys.mac, factor.recoveryCode as string);
      if (!(await this.totp.spendRecoveryCode(customer.id, hash, now))) {
        return this.wrongCode(customer.id, attempt, 'handoff', context, now);
      }
      await this.audit.record({
        customerId: customer.id,
        action: AuditAction.TOTP_RECOVERY_CODE_USED,
        success: true,
        ...context,
        metadata: { left: await this.totp.countRecoveryCodesLeft(customer.id) },
      });
      kind = 'recovery';
    }
    const exp = Math.floor(now.getTime() / 1000) + SECOND_FACTOR_TICKET_TTL_SECONDS;
    return {
      kind,
      ticket: signTicket(keys.mac, customer.id, credential.secretSealed, exp),
      ticketExpiresIn: SECOND_FACTOR_TICKET_TTL_SECONDS,
    };
  }

  private keys(): TotpKeys {
    const keys = this.config.totpKeys;
    if (!keys) throw new TotpOffError();
    return keys;
  }

  /**
   * Counts this try before any code is compared. Parallel requests each get their own
   * number, so at most five are ever compared per lock window; the ones past five lock it.
   */
  private async claimAttempt(
    credential: TotpCredentialRecord,
    step: Step,
    context: RequestContext,
    now: Date,
  ): Promise<number> {
    const attempt = await this.totp.claimAttempt(credential.customerId, now);
    const lockedUntil = new Date(now.getTime() + TOTP_LOCK_SECONDS * 1000);
    if (attempt === null) {
      const until = credential.lockedUntil && credential.lockedUntil > now ? credential.lockedUntil : lockedUntil;
      return this.refuseLocked(credential.customerId, until, step, context, now);
    }
    if (attempt > MAX_TOTP_FAILURES) {
      await this.totp.lock(credential.customerId, lockedUntil);
      return this.refuseLocked(credential.customerId, lockedUntil, step, context, now);
    }
    return attempt;
  }

  private async refuseLocked(
    customerId: string,
    until: Date,
    step: Step,
    context: RequestContext,
    now: Date,
  ): Promise<never> {
    await this.audit.record({
      customerId,
      action: AuditAction.TOTP_FAILED,
      success: false,
      ...context,
      metadata: { step, reason: 'locked' },
    });
    throw new TotpLockedError(Math.ceil((until.getTime() - now.getTime()) / 1000));
  }

  private async wrongCode(
    customerId: string,
    attempt: number,
    step: Step,
    context: RequestContext,
    now: Date,
  ): Promise<never> {
    const locked = attempt >= MAX_TOTP_FAILURES;
    if (locked) await this.totp.lock(customerId, new Date(now.getTime() + TOTP_LOCK_SECONDS * 1000));
    await this.audit.record({
      customerId,
      action: AuditAction.TOTP_FAILED,
      success: false,
      ...context,
      metadata: { step, reason: 'wrong', attempt, locked },
    });
    throw new InvalidTotpCodeError();
  }
}
