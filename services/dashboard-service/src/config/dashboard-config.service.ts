import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BUSINESS_TIME_ZONE } from '@hydromart/platform';

@Injectable()
export class DashboardConfigService {
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
    return this.num('DASHBOARD_SERVICE_PORT');
  }
  get orderServiceUrl(): string {
    return this.config.getOrThrow<string>('ORDER_SERVICE_URL').replace(/\/+$/, '');
  }
  get deliveryServiceUrl(): string {
    return this.config.getOrThrow<string>('DELIVERY_SERVICE_URL').replace(/\/+$/, '');
  }
  get depotServiceUrl(): string {
    return this.config.getOrThrow<string>('DEPOT_SERVICE_URL').replace(/\/+$/, '');
  }
  /** Optional — undefined when admin-service isn't wired for SLA-policy lookup. */
  get adminServiceUrl(): string | undefined {
    return this.config.get<string>('ADMIN_SERVICE_URL')?.replace(/\/+$/, '');
  }
  /** Optional (Fase 5) — undefined → owner franchise dashboard omits the HR block. */
  get hrServiceUrl(): string | undefined {
    return this.config.get<string>('HR_SERVICE_URL')?.replace(/\/+$/, '');
  }
  /** Optional (Fase 5) — undefined → owner franchise dashboard omits the CRM block. */
  get customerServiceUrl(): string | undefined {
    return this.config.get<string>('CUSTOMER_SERVICE_URL')?.replace(/\/+$/, '');
  }
  get internalServiceKey(): string {
    return this.config.getOrThrow<string>('INTERNAL_SERVICE_KEY');
  }
  /** auth-service base URL; used to put a name on each "Pelanggan teratas" row (§G-3). */
  get authServiceUrl(): string {
    return this.config.get<string>('AUTH_SERVICE_URL', '').replace(/\/+$/, '');
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

  /** The one business timezone (H-16); every day/month boundary here is reckoned in it. */
  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', BUSINESS_TIME_ZONE);
  }
}
