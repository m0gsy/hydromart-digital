import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class DepotConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsCache,
  ) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  /**
   * Effective business value: depot override ?? global override ?? `envValue`.
   * `envValue` is always the getter's own current ENV read (not
   * `SETTING_DEF_BY_KEY[key].envDefault` — that field is only the UI's documented
   * default and, for a couple of keys, intentionally differs from the real ENV
   * default; using it here would silently change today's behavior).
   */
  private tunable(key: string, envValue: number, depotId: string | null): number {
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
  /** Catalog read for PRODUK line validation. Blank = accept lines unvalidated. */
  get productServiceUrl(): string {
    return this.config.get<string>('PRODUCT_SERVICE_URL', '').replace(/\/+$/, '');
  }
  // Closing a cashier's shift asks payment-service what that depot's drawer took. Blank =
  // the shift cannot be closed at all; a made-up "expected" would accuse a cashier of a
  // shortfall that only ever existed in the config.
  get paymentServiceUrl(): string {
    return this.config.get<string>('PAYMENT_SERVICE_URL', '');
  }
  // Closing a day's books asks delivery-service what COD the depot accepted. Blank = the
  // day cannot be closed: counting only the counter cash and calling it the day's takings
  // is worse than refusing.
  get deliveryServiceUrl(): string {
    return this.config.get<string>('DELIVERY_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /** Shared secret sent as x-internal-key on the crm internal notification call. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** auth-service base URL — where the shared audit trail lives (H-29). */
  get authServiceUrl(): string {
    return this.config.get<string>('AUTH_SERVICE_URL', '').replace(/\/+$/, '');
  }
  // Static-QRIS image storage. Same contract as product/auth/delivery-service: the URL
  // handed back is absolute, because the customer's payment screen renders it directly.
  get storageLocalDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', './var/uploads');
  }
  get storagePublicBaseUrl(): string {
    return this.config
      .get<string>('STORAGE_PUBLIC_BASE_URL', 'http://localhost:3007')
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
  get pricingTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', 'Asia/Jakarta');
  }
  /** Per-gallon deposit refunded on a courier-recorded return (design 2e). Server derives
   *  the refund as GALLON_DEPOSIT_IDR × quantity — the courier never enters an amount. */
  gallonDepositIdr(depotId: string | null = null): number {
    return this.tunable('gallonDepositIdr', this.num('GALLON_DEPOSIT_IDR'), depotId);
  }
  /** Manager approval queue: value changes at/under this rupiah amount auto-pass without review. */
  approvalAutoPassIdr(depotId: string | null = null): number {
    return this.tunable('approvalAutoPassIdr', this.num('APPROVAL_AUTO_PASS_IDR'), depotId);
  }
}
