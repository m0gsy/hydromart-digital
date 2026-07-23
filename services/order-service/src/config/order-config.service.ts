import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class OrderConfigService {
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
   * `SETTING_DEF_BY_KEY[key].envDefault` (that field is only the UI's documented default).
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
    return this.num('ORDER_SERVICE_PORT');
  }
  get productServiceUrl(): string {
    return this.config.getOrThrow<string>('PRODUCT_SERVICE_URL').replace(/\/+$/, '');
  }
  get depotServiceUrl(): string {
    return this.config.getOrThrow<string>('DEPOT_SERVICE_URL').replace(/\/+$/, '');
  }
  get loyaltyServiceUrl(): string {
    return this.config.getOrThrow<string>('LOYALTY_SERVICE_URL').replace(/\/+$/, '');
  }
  get promoServiceUrl(): string {
    return this.config.getOrThrow<string>('PROMO_SERVICE_URL').replace(/\/+$/, '');
  }
  get referralServiceUrl(): string {
    return this.config.getOrThrow<string>('REFERRAL_SERVICE_URL').replace(/\/+$/, '');
  }
  get crmServiceUrl(): string {
    return this.config.getOrThrow<string>('CRM_SERVICE_URL').replace(/\/+$/, '');
  }
  get recommendationServiceUrl(): string {
    return this.config.get<string>('RECOMMENDATION_SERVICE_URL', '').replace(/\/+$/, '');
  }
  get forecastServiceUrl(): string {
    return this.config.get<string>('FORECAST_SERVICE_URL', '').replace(/\/+$/, '');
  }
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** Flat per-galon delivery fee (IDR) used when checkout has no routed depot. */
  deliveryFee(depotId: string | null = null): number {
    return this.tunable('deliveryFee', this.num('ORDER_DELIVERY_FEE'), depotId);
  }
  /**
   * Age (minutes) after which an unconfirmed CREATED order is auto-cancelled. The
   * abandoned-order sweep runs platform-wide (no single depot in scope), so this
   * stays a no-arg getter; it still resolves a GLOBAL override through the cache.
   */
  get abandonMinutes(): number {
    return this.tunable('abandonMinutes', this.num('ORDER_ABANDON_MINUTES'));
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
}
