import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BUSINESS_TIME_ZONE } from '@hydromart/platform';

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
  /** Shared secret sent as x-internal-key on the loyalty reward call. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** product-service base URL for the favourite catalog check; blank → check skipped. */
  get productServiceUrl(): string {
    return this.config.get<string>('PRODUCT_SERVICE_URL', '').trim();
  }
  /** order-service base URL for the CRM order-aggregate port; blank → CRM shows no order data. */
  /** auth-service base URL — pre-registers imported customers (bulk import). */
  get authServiceUrl(): string {
    return this.config.get<string>('AUTH_SERVICE_URL', '').trim();
  }

  get orderServiceUrl(): string {
    return this.config.get<string>('ORDER_SERVICE_URL', '').trim();
  }
  /** depot-service, for the directory's gallons-on-loan and deposit-held columns (J-2). */
  get depotServiceUrl(): string {
    return this.config.get<string>('DEPOT_SERVICE_URL', '').trim();
  }
  /** forecast-service, for the depot CRM card's churn band (S2). Blank = the card says "—". */
  get forecastServiceUrl(): string {
    return this.config.get<string>('FORECAST_SERVICE_URL', '').trim();
  }
  /** CRM lifecycle thresholds (Fase 4). Env-overridable; company-policy defaults. */
  get crmThresholds(): { newDays: number; activeDays: number; followUpDays: number } {
    return {
      newDays: Number(this.config.get<string>('CRM_NEW_DAYS', '30')),
      activeDays: Number(this.config.get<string>('CRM_ACTIVE_DAYS', '30')),
      followUpDays: Number(this.config.get<string>('CRM_FOLLOWUP_DAYS', '60')),
    };
  }

  // Agen registration-photo storage. Same contract and same env names as
  // depot/product/auth-service: the URL handed back is absolute, because the ops console
  // renders it with no base URL of this service to prepend.
  get storageLocalDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', './var/uploads');
  }
  get storagePublicBaseUrl(): string {
    return this.config
      .get<string>('STORAGE_PUBLIC_BASE_URL', 'http://localhost:3003')
      .replace(/\/+$/, '');
  }
  get storageDriver(): 'local' | 's3' {
    return this.config.get<string>('STORAGE_DRIVER', 'local') === 's3' ? 's3' : 'local';
  }
  get s3(): {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } {
    return {
      endpoint: this.config.getOrThrow<string>('STORAGE_S3_ENDPOINT'),
      region: this.config.get<string>('STORAGE_S3_REGION', 'auto'),
      bucket: this.config.getOrThrow<string>('STORAGE_S3_BUCKET'),
      accessKeyId: this.config.getOrThrow<string>('STORAGE_S3_ACCESS_KEY_ID'),
      secretAccessKey: this.config.getOrThrow<string>('STORAGE_S3_SECRET_ACCESS_KEY'),
    };
  }

  /** The one business timezone (H-16); every day/month boundary here is reckoned in it. */
  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', BUSINESS_TIME_ZONE);
  }
}
