import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Maps a public path segment (`/{segment}/...`) to the env var holding the
 * upstream base URL it proxies to. Segment names are plural/public-facing;
 * the env var names follow each service's own convention.
 */
const SEGMENT_ENV: Record<string, string> = {
  auth: 'AUTH_SERVICE_URL',
  customers: 'CUSTOMER_SERVICE_URL',
  products: 'PRODUCT_SERVICE_URL',
  orders: 'ORDER_SERVICE_URL',
  payments: 'PAYMENT_SERVICE_URL',
  deliveries: 'DELIVERY_SERVICE_URL',
  depots: 'DEPOT_SERVICE_URL',
  dashboard: 'DASHBOARD_SERVICE_URL',
  loyalty: 'LOYALTY_SERVICE_URL',
  vouchers: 'PROMO_SERVICE_URL',
  referrals: 'REFERRAL_SERVICE_URL',
  crm: 'CRM_SERVICE_URL',
  recommendations: 'RECOMMENDATION_SERVICE_URL',
  forecast: 'FORECAST_SERVICE_URL',
  payout: 'PAYOUT_SERVICE_URL',
};

@Injectable()
export class GatewayConfigService {
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
    return this.num('GATEWAY_PORT');
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

  /** service segment -> upstream base URL (trailing slashes stripped). */
  upstreams(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [segment, envKey] of Object.entries(SEGMENT_ENV)) {
      map[segment] = this.config.getOrThrow<string>(envKey).replace(/\/+$/, '');
    }
    return map;
  }
}
