import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DepotConfigService {
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
    return this.num('DEPOT_SERVICE_PORT');
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
  // Low-stock alerting (optional). Both blank in dev = feature off (no alert emitted).
  get crmServiceUrl(): string {
    return this.config.get<string>('CRM_SERVICE_URL', '');
  }
  get alertPhone(): string {
    return this.config.get<string>('DEPOT_ALERT_PHONE', '');
  }
  get pricingTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', 'Asia/Jakarta');
  }
}
