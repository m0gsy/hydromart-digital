import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class LoyaltyConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsCache,
  ) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  /**
   * Effective business value: depot override ?? global override ?? `envValue`.
   * `envValue` is always the getter's own current ENV read, not
   * `SETTING_DEF_BY_KEY[key].envDefault` (that field is only the UI's documented
   * default).
   */
  private tunable(key: string, envValue: number, depotId: string | null = null): number {
    const def = SETTING_DEF_BY_KEY[key];
    return this.settings.effective(key, def.type, envValue, depotId) as number;
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
  earnRateRupiah(depotId: string | null = null): number {
    return this.tunable('earnRateRupiah', this.num('LOYALTY_EARN_RATE_RUPIAH'), depotId);
  }
  /** Months a point remains valid after it is earned (BR-014). */
  pointExpiryMonths(depotId: string | null = null): number {
    return this.tunable('pointExpiryMonths', this.num('LOYALTY_POINT_EXPIRY_MONTHS'), depotId);
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
