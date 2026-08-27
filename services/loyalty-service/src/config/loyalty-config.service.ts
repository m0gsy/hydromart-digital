import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache, BUSINESS_TIME_ZONE } from '@hydromart/platform';

import { MembershipTier, TIER_BENEFITS, TierBenefit } from '../domain/membership';
import { SETTING_DEF_BY_KEY, TIER_SETTING_KEYS } from './setting-defs';

@Injectable()
export class LoyaltyConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsCache,
  ) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  /**
   * Effective business value: depot override ?? global override ?? `envValue`.
   * `envValue` is always the getter's own current ENV read, not
   * `SETTING_DEF_BY_KEY[key].envDefault` (that field is only the UI's documented
   * default).
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
    return this.num('LOYALTY_SERVICE_PORT');
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
  /** Rupiah of order subtotal that earns one point (BR-013). */
  earnRateRupiah(depotId: string | null = null): number {
    return this.tunable('earnRateRupiah', this.num('LOYALTY_EARN_RATE_RUPIAH'), depotId);
  }
  /**
   * PAR-01: whether the scheduled expiry sweep actually expires anything. Global only —
   * a depot cannot decide that the points on a customer's card survive longer there.
   */
  get pointExpirySweepEnabled(): boolean {
    return (
      this.tunable(
        'pointExpirySweepEnabled',
        this.num('LOYALTY_POINT_EXPIRY_SWEEP_ENABLED'),
        null,
      ) === 1
    );
  }

  /** Months a point remains valid after it is earned (BR-014). */
  pointExpiryMonths(depotId: string | null = null): number {
    return this.tunable('pointExpiryMonths', this.num('LOYALTY_POINT_EXPIRY_MONTHS'), depotId);
  }

  /**
   * The membership ladder in force at `depotId` (null = global/default). Each paid rung's
   * threshold and rate are independently overridable, so a depot decides both who counts
   * as GOLD there and what GOLD costs it. REGULAR is not tunable — it is the floor.
   *
   * Unlike the other tunables the fallback is the TIER_BENEFITS constant, not an env read:
   * the ladder's documented default already lives in the domain and duplicating it across
   * six env vars would make them disagree eventually.
   */
  tierBenefits(depotId: string | null): TierBenefit[] {
    return TIER_BENEFITS.map((base) => {
      if (base.tier === MembershipTier.REGULAR) return { ...base };
      const keys = TIER_SETTING_KEYS[base.tier];
      return {
        tier: base.tier,
        threshold: this.tunable(keys.threshold, base.threshold, depotId),
        // Settings hold whole percent (an operator types "5"); the domain wants 0.05.
        discountRate: this.tunable(keys.discountPct, base.discountRate * 100, depotId) / 100,
      };
    });
  }
  /** customer-service base URL for depot-scoped aggregates; blank = no directory (returns zeros). */
  get customerServiceUrl(): string {
    return this.config.get<string>('CUSTOMER_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /** Shared service-to-service secret (x-internal-key). Blank = internal calls disabled. */
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }

  /** The one business timezone (H-16); every day/month boundary here is reckoned in it. */
  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', BUSINESS_TIME_ZONE);
  }
}
