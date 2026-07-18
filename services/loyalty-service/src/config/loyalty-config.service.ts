import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoyaltyConfigService {
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
    return this.num('LOYALTY_SERVICE_PORT');
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
  /** Rupiah of order subtotal that earns one point (BR-013). */
  get earnRateRupiah(): number {
    return this.num('LOYALTY_EARN_RATE_RUPIAH');
  }
  /** Months a point remains valid after it is earned (BR-014). */
  get pointExpiryMonths(): number {
    return this.num('LOYALTY_POINT_EXPIRY_MONTHS');
  }
  /** customer-service base URL for depot-scoped aggregates; blank = no directory (returns zeros). */
  get customerServiceUrl(): string {
    return this.config.get<string>('CUSTOMER_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /** Shared service-to-service secret (x-internal-key). Blank = internal calls disabled. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
}
