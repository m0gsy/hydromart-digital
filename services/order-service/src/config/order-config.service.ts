import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OrderConfigService {
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
  get deliveryFee(): number {
    return this.num('ORDER_DELIVERY_FEE');
  }
  get abandonMinutes(): number {
    return this.num('ORDER_ABANDON_MINUTES');
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
