import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class ReferralConfigService {
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
   * default; using it here would silently change today's behavior if they ever drift).
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
    return this.num('REFERRAL_SERVICE_PORT');
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
  /** loyalty-service base URL; referral qualification awards points there (FR-092). */
  get loyaltyServiceUrl(): string {
    return this.config.getOrThrow<string>('LOYALTY_SERVICE_URL');
  }
  /** Shared secret sent as x-internal-key on the loyalty reward call. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** customer-service base URL; depot referral aggregates resolve depot->customerIds there.
   *  Blank = no directory lookup (aggregate degrades to zeros). */
  get customerServiceUrl(): string {
    return this.config.get<string>('CUSTOMER_SERVICE_URL', '');
  }
  /**
   * Points granted to the referrer when a referral qualifies (FR-092). Global-only
   * tunable — qualify() has no depotId in scope (see setting-defs.ts).
   */
  get referrerPoints(): number {
    return this.tunable('referrerPoints', this.num('REFERRAL_REFERRER_POINTS'));
  }
  /**
   * Welcome-bonus points granted to the referee when a referral qualifies (FR-092).
   * Global-only tunable — qualify() has no depotId in scope (see setting-defs.ts).
   */
  get refereePoints(): number {
    return this.tunable('refereePoints', this.num('REFERRAL_REFEREE_POINTS'));
  }
}
