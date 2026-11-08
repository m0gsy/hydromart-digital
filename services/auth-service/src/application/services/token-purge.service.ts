import { Inject, Injectable } from '@nestjs/common';

import { OtpTokenRepository } from '../ports/otp-token.repository';
import { RefreshTokenRepository } from '../ports/refresh-token.repository';
import { ClockPort } from '../ports/clock.port';
import { AUTH_TOKENS } from '../tokens';

const MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * AUT-08 - nothing ever deleted an OTP challenge or a refresh token. The expired ones are
 * dead weight, and they keep what was sent where (`targetPhone`, IP, user agent) long after
 * the code or session stopped meaning anything.
 *
 * The caller names the cutoff, like the audit purge. It is clamped to a day before now so a
 * wrong clock or a typo cannot reach a challenge someone is still typing.
 */
@Injectable()
export class TokenPurgeService {
  constructor(
    @Inject(AUTH_TOKENS.OtpTokenRepository) private readonly otp: OtpTokenRepository,
    @Inject(AUTH_TOKENS.RefreshTokenRepository) private readonly refresh: RefreshTokenRepository,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
  ) {}

  async purgeExpired(cutoff: Date): Promise<{ otpTokens: number; refreshTokens: number }> {
    const floor = new Date(this.clock.now().getTime() - MIN_AGE_MS);
    const effective = cutoff.getTime() > floor.getTime() ? floor : cutoff;
    const [otpTokens, refreshTokens] = await Promise.all([
      this.otp.deleteExpiredBefore(effective),
      this.refresh.deleteExpiredBefore(effective),
    ]);
    return { otpTokens, refreshTokens };
  }
}
