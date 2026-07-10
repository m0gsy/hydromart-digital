import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Typed accessor over validated configuration. */
@Injectable()
export class CustomerConfigService {
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
    return this.num('CUSTOMER_SERVICE_PORT');
  }
  get maxAddresses(): number {
    return this.num('MAX_ADDRESSES_PER_CUSTOMER');
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
  /** loyalty-service base URL; blank disables the birthday promo (FR-091). */
  get loyaltyServiceUrl(): string {
    return this.config.get<string>('LOYALTY_SERVICE_URL', '').trim();
  }
  /** Points granted on a customer's birthday (FR-091, company policy default). */
  get birthdayRewardPoints(): number {
    return this.num('BIRTHDAY_REWARD_POINTS');
  }
}
