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
  /** Shared secret sent as x-internal-key on the crm internal notification call. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
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
