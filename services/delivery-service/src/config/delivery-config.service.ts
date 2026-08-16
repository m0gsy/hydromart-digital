import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache, BUSINESS_TIME_ZONE } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class DeliveryConfigService {
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
  /** admin-service base URL for the partner webhook fan-out. Blank = no events published. */
  get adminServiceUrl(): string {
    return this.config.get<string>('ADMIN_SERVICE_URL', '').replace(/\/+$/, '');
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
  /** Per-driver active-delivery cap (BR: one driver = one active order at a time). */
  maxActiveDeliveriesPerDriver(depotId: string | null = null): number {
    return this.tunable(
      'maxActiveDeliveriesPerDriver',
      this.num('MAX_ACTIVE_DELIVERIES_PER_DRIVER'),
      depotId,
    );
  }
  /** How close to the depot a courier must be to check in, in metres. */
  shiftCheckInRadiusMeters(depotId: string | null = null): number {
    return this.tunable('shiftCheckInRadiusMeters', this.num('SHIFT_CHECKIN_RADIUS_M'), depotId);
  }
  /** Oldest device timestamp still accepted from the offline queue. */
  offlineMaxAgeHours(depotId: string | null = null): number {
    return this.tunable('offlineMaxAgeHours', 12, depotId);
  }
  shiftLengthHours(depotId: string | null = null): number {
    return this.tunable('shiftLengthHours', this.num('SHIFT_LENGTH_HOURS'), depotId);
  }
  shiftBreakQuotaMinutes(depotId: string | null = null): number {
    return this.tunable(
      'shiftBreakQuotaMinutes',
      this.num('SHIFT_BREAK_QUOTA_MINUTES'),
      depotId,
    );
  }
  /** Minimum contact attempts before a no-show may be declared (design 5a). */
  noShowMinContactAttempts(depotId: string | null = null): number {
    return this.tunable(
      'noShowMinContactAttempts',
      this.num('NO_SHOW_MIN_CONTACT_ATTEMPTS'),
      depotId,
    );
  }
  /** Minimum wait (seconds, from first attempt) before a no-show may be declared. */
  noShowMinWaitSeconds(depotId: string | null = null): number {
    return this.tunable('noShowMinWaitSeconds', this.num('NO_SHOW_MIN_WAIT_SECONDS'), depotId);
  }
  slaMinutes(depotId: string | null = null): number {
    return this.tunable('slaMinutes', this.num('DELIVERY_SLA_MINUTES'), depotId);
  }
  /**
   * Assumed average urban courier speed (km/h) for the customer-facing ETA at
   * ON_DELIVERY start (straight-line distance ÷ this). Deliberately low to absorb
   * the haversine underestimate vs. real road distance. Default fills it so no
   * compose change is needed.
   * // ponytail: flat constant — no traffic / time-of-day / road-network model.
   * // Calibrate against real assignedAt→deliveredAt data once enough deliveries
   * // exist (now editable per-depot via the settings cache if speeds diverge).
   */
  urbanSpeedKmph(depotId: string | null = null): number {
    return this.tunable(
      'urbanSpeedKmph',
      Number(this.config.get('DELIVERY_URBAN_SPEED_KMPH', 18)),
      depotId,
    );
  }
  /**
   * Minutes spent at each drop, for the multi-stop route ETA. Paired with
   * `urbanSpeedKmph`: riding time comes from the speed, standing time from this.
   */
  routeStopMinutes(depotId: string | null = null): number {
    return this.tunable(
      'routeStopMinutes',
      Number(this.config.get('DELIVERY_ROUTE_STOP_MINUTES', 4)),
      depotId,
    );
  }
  /** Weekly delivered-orders target on the courier performance card (design 4c). */
  courierWeeklyTarget(depotId: string | null = null): number {
    return this.tunable('courierWeeklyTarget', this.num('COURIER_WEEKLY_TARGET'), depotId);
  }
  /*
   * `courierRatePerDeliveryIdr` was here, and it is deleted rather than left unread (E-1).
   *
   * Its ONLY reader was the commission report, which now reads what payout-service actually
   * credited. A flat rate a depot can still edit, in the service that pays nobody, is the
   * second number this change exists to remove — leaving the knob would have left the bug
   * one config screen away from coming back. Rows already stored under this key in
   * `service_settings` simply stop being read; no migration deletes them.
   */
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

  /** The one business timezone (H-16); every day/month boundary here is reckoned in it. */
  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', BUSINESS_TIME_ZONE);
  }
}
