import { Inject, Injectable } from '@nestjs/common';

import { Customer } from '../../domain/customer/customer.entity';
import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import {
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
   */
  async issue(customer: Customer, purpose: OtpPurpose): Promise<OtpChallengeResult> {
    const policy = this.config.otpPolicy;
    const now = this.clock.now();

    const existing = await this.otpTokens.findActive(customer.id, purpose);
    if (existing) {
      const secondsSinceIssued = (now.getTime() - existing.createdAt.getTime()) / 1000;
      const remaining = Math.ceil(policy.resendCooldownSeconds - secondsSinceIssued);
      if (remaining > 0) {
        throw new OtpResendCooldownError(remaining);
      }
      await this.otpTokens.consumeAllForPurpose(customer.id, purpose, now);
    }

    const code = this.crypto.generateNumericCode(policy.length);
    const codeHash = await this.crypto.hashSecret(code);
    const expiresAt = new Date(now.getTime() + policy.ttlSeconds * 1000);

    await this.otpTokens.create({ customerId: customer.id, purpose, codeHash, expiresAt });

    await this.delivery.send({
      phone: customer.phone,
      code,
      purpose,
      ttlSeconds: policy.ttlSeconds,
    });

    return {
      phoneMasked: OtpService.maskPhone(customer.phone),
      expiresInSeconds: policy.ttlSeconds,
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
      throw new OtpInvalidError('The verification code has expired.');
    }
    if (record.attempts >= policy.maxAttempts) {
      throw new OtpMaxAttemptsError();
    }

    const matches = await this.crypto.verifySecret(code, record.codeHash);
    if (!matches) {
      await this.otpTokens.incrementAttempts(record.id);
      if (record.attempts + 1 >= policy.maxAttempts) {
        throw new OtpMaxAttemptsError();
      }
      throw new OtpInvalidError();
    }

    await this.otpTokens.markConsumed(record.id, now);
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
