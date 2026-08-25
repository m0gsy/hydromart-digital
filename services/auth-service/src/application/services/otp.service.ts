import { Inject, Injectable, Logger } from '@nestjs/common';

import { Customer } from '../../domain/customer/customer.entity';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import {
  OtpDeliveryUnavailableError,
  OtpExpiredError,
  OtpInvalidError,
  OtpMaxAttemptsError,
  OtpResendCooldownError,
} from '../../domain/errors/auth.errors';
import { AuthConfigService } from '../../config/auth-config.service';
import { ClockPort } from '../ports/clock.port';
import { CryptoPort } from '../ports/crypto.port';
import { OtpDeliveryPort } from '../ports/otp-delivery.port';
import { OtpTokenRepository } from '../ports/otp-token.repository';
import { AUTH_TOKENS } from '../tokens';
import { OtpChallengeResult } from '../results';

/**
 * OTP challenge lifecycle (PRD FR-002/003/004, BR-002). Codes are stored hashed,
 * single-use, time-limited, attempt-limited, and rate-limited on resend.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(AUTH_TOKENS.OtpTokenRepository) private readonly otpTokens: OtpTokenRepository,
    @Inject(AUTH_TOKENS.OtpDeliveryPort) private readonly delivery: OtpDeliveryPort,
    @Inject(AUTH_TOKENS.CryptoPort) private readonly crypto: CryptoPort,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
    private readonly config: AuthConfigService,
  ) {}

  /**
   * Issue (or re-issue) an OTP challenge for a customer and deliver it. Enforces
   * the resend cooldown and invalidates any previously outstanding code.
   *
   * K1.4: `deliverTo` sends the code somewhere other than the account's own number, and
   * records where. That is a phone CHANGE and nothing else — a code proving control of a
   * number the account does not own yet. It is recorded rather than merely used because
   * the confirm step has to read the destination back from the challenge; asking the
   * client for it again would let a code delivered to one number move the account onto
   * another.
   */
  async issue(
    customer: Customer,
    purpose: OtpPurpose,
    deliverTo?: string,
  ): Promise<OtpChallengeResult> {
    const policy = this.config.otpPolicy;
    const now = this.clock.now();
    const destination = deliverTo ?? customer.phone;

    const existing = await this.otpTokens.findActive(customer.id, purpose);
    if (existing) {
      const secondsSinceIssued = (now.getTime() - existing.createdAt.getTime()) / 1000;
      const remaining = Math.ceil(policy.resendCooldownSeconds - secondsSinceIssued);
      if (remaining > 0) {
        throw new OtpResendCooldownError(remaining);
      }
      await this.otpTokens.consumeAllForPurpose(customer.id, purpose, now);
    }

    const fixed = this.fixedCodeFor(destination);
    const code = fixed ?? this.crypto.generateNumericCode(policy.length);
    const codeHash = await this.crypto.hashSecret(code);
    const expiresAt = new Date(now.getTime() + policy.ttlSeconds * 1000);

    await this.otpTokens.create({
      customerId: customer.id,
      purpose,
      codeHash,
      expiresAt,
      targetPhone: deliverTo ?? null,
    });

    // A reviewer number is not sent its code: whoever uses it already has it from the Play
    // Console listing, so delivery buys nothing and costs something. The demo numbers are
    // not always SIMs the company holds, and an SMS to one of those rings a stranger's
    // phone on every sign-in attempt during review. Only the delivery is skipped — the
    // challenge is stored, expires and is verified exactly like any other.
    if (!fixed) {
      try {
        await this.delivery.send({
          phone: destination,
          code,
          purpose,
          ttlSeconds: policy.ttlSeconds,
        });
      } catch (error) {
        // The challenge above is already stored, so a retry mints a fresh code rather than
        // landing on a dead end. What must NOT happen is the adapter's raw failure reaching
        // the client as a 500 — an unreachable SMS gateway is an outage the caller can only
        // respond to if it is named.
        this.logger.error(
          `OTP delivery failed for ${OtpService.maskPhone(destination)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw new OtpDeliveryUnavailableError();
      }
    }

    return {
      phoneMasked: OtpService.maskPhone(destination),
      expiresInSeconds: policy.ttlSeconds,
      resendCooldownSeconds: policy.resendCooldownSeconds,
    };
  }

  /**
   * Verify a submitted code against the active challenge. Consumes the challenge on
   * success; increments the attempt counter and throws on failure.
   */
  async verify(customer: Customer, purpose: OtpPurpose, code: string): Promise<void> {
    const policy = this.config.otpPolicy;
    const now = this.clock.now();

    const record = await this.otpTokens.findActive(customer.id, purpose);
    if (!record || record.consumedAt) {
      throw new OtpInvalidError();
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new OtpExpiredError();
    }
    // Claim the guess BEFORE comparing, in one conditional write. Read-check-then-increment
    // around a ~100ms bcrypt compare let N parallel requests all read attempts=0, all pass
    // the check and all get a free guess — the limit then bounded rounds, not guesses.
    if (!(await this.otpTokens.claimAttempt(record.id, policy.maxAttempts))) {
      throw new OtpMaxAttemptsError();
    }

    const matches = await this.crypto.verifySecret(code, record.codeHash);
    if (!matches) {
      if (record.attempts + 1 >= policy.maxAttempts) {
        throw new OtpMaxAttemptsError();
      }
      throw new OtpInvalidError();
    }

    await this.otpTokens.markConsumed(record.id, now);
  }

  /**
   * J6. The Play reviewer's number gets a code that does not change; every other number
   * gets a random one, which is every number when the feature is unconfigured.
   *
   * Note where this sits, and where it deliberately does not. It replaces the value the
   * generator would have produced and suppresses the SMS for that number, and then nothing
   * else changes: the code is hashed the
   * same way, stored the same way, expires on the same clock, is consumed on first use and
   * is bounded by the same attempt limit. `verify()` has no idea this exists and must
   * never gain one — a branch there would be a way into the app that skips checking a
   * credential, which is a different thing entirely from a credential that is predictable.
   *
   * An exact string match, not a normalised or partial one. Phone numbers in this system
   * are already stored in one canonical form, and a looser comparison here is a wider door
   * than anybody asked for.
   */
  private fixedCodeFor(phone: string): string | null {
    const reviewer = this.config.reviewerOtp;
    return reviewer?.phones.includes(phone) ? reviewer.code : null;
  }

  /** Mask a phone number for safe display: keep country code + last 3 digits. */
  static maskPhone(phone: string): string {
    if (phone.length <= 7) {
      return phone;
    }
    const head = phone.slice(0, 5);
    const tail = phone.slice(-3);
    const masked = '*'.repeat(Math.max(phone.length - head.length - tail.length, 0));
    return `${head}${masked}${tail}`;
  }
}
