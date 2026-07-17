import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DeliveryConfigService {
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
    return this.num('DELIVERY_SERVICE_PORT');
  }
  get orderServiceUrl(): string {
    return this.config.getOrThrow<string>('ORDER_SERVICE_URL').replace(/\/+$/, '');
  }
  get depotServiceUrl(): string {
    return this.config.getOrThrow<string>('DEPOT_SERVICE_URL').replace(/\/+$/, '');
  }
  /** payment-service base URL for the COD cash-collected read (settlement, fail-closed). */
  get paymentServiceUrl(): string {
    return this.config.getOrThrow<string>('PAYMENT_SERVICE_URL').replace(/\/+$/, '');
  }
  /** crm-service base URL for the internal ops-incident push. Blank = disabled. */
  get crmServiceUrl(): string {
    return this.config.get<string>('CRM_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /** payout-service base URL for the courier earning push. Blank = disabled (fail-open). */
  get payoutServiceUrl(): string {
    return this.config.get<string>('PAYOUT_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /** Shared service-to-service key (x-internal-key). Blank = internal calls disabled. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** WhatsApp number HIGH incidents alert. Blank = ops alerting disabled. */
  get opsAlertPhone(): string {
    return this.config.get<string>('OPS_ALERT_PHONE', '');
  }
  get maxActiveDeliveriesPerDriver(): number {
    return this.num('MAX_ACTIVE_DELIVERIES_PER_DRIVER');
  }
  /** How close to the depot a courier must be to check in, in metres. */
  get shiftCheckInRadiusMeters(): number {
    return this.num('SHIFT_CHECKIN_RADIUS_M');
  }
  get shiftLengthHours(): number {
    return this.num('SHIFT_LENGTH_HOURS');
  }
  get shiftBreakQuotaMinutes(): number {
    return this.num('SHIFT_BREAK_QUOTA_MINUTES');
  }
  /** Minimum contact attempts before a no-show may be declared (design 5a). */
  get noShowMinContactAttempts(): number {
    return this.num('NO_SHOW_MIN_CONTACT_ATTEMPTS');
  }
  /** Minimum wait (seconds, from first attempt) before a no-show may be declared. */
  get noShowMinWaitSeconds(): number {
    return this.num('NO_SHOW_MIN_WAIT_SECONDS');
  }
  get slaMinutes(): number {
    return this.num('DELIVERY_SLA_MINUTES');
  }
  /** Weekly delivered-orders target on the courier performance card (design 4c). */
  get courierWeeklyTarget(): number {
    return this.num('COURIER_WEEKLY_TARGET');
  }
  /** UU PDP retention window for proof-of-delivery records, in days. */
  get podRetentionDays(): number {
    return this.num('POD_RETENTION_DAYS');
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
  get storageLocalDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', './var/uploads');
  }
  get storagePublicBaseUrl(): string {
    return this.config
      .get<string>('STORAGE_PUBLIC_BASE_URL', 'http://localhost:3006')
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
}
