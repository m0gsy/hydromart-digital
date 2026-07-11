import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ReferralConfigService {
  constructor(private readonly config: ConfigService) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.num('REFERRAL_SERVICE_PORT');
  }
  get corsOrigins(): string[] {
    return this.config
      .get<string>('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }
  get rateLimit(): { ttlSeconds: number; limit: number } {
    return { ttlSeconds: this.num('RATE_LIMIT_TTL_SECONDS'), limit: this.num('RATE_LIMIT_MAX') };
  }
  /** loyalty-service base URL; referral qualification awards points there (FR-092). */
  get loyaltyServiceUrl(): string {
    return this.config.getOrThrow<string>('LOYALTY_SERVICE_URL');
  }
  /** Shared secret sent as x-internal-key on the loyalty reward call. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** Points granted to the referrer when a referral qualifies (FR-092). */
  get referrerPoints(): number {
    return this.num('REFERRAL_REFERRER_POINTS');
  }
  /** Welcome-bonus points granted to the referee when a referral qualifies (FR-092). */
  get refereePoints(): number {
    return this.num('REFERRAL_REFEREE_POINTS');
  }
}
