import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BUSINESS_TIME_ZONE, SettingsCache } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class OrderConfigService {
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
   * `SETTING_DEF_BY_KEY[key].envDefault` (that field is only the UI's documented default).
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
  get customerServiceUrl(): string {
    return this.config.getOrThrow<string>('CUSTOMER_SERVICE_URL').replace(/\/+$/, '');
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
  /** Blank disables the franchise revenue push (dev default), like the other optionals. */
  get payoutServiceUrl(): string {
    return this.config.get<string>('PAYOUT_SERVICE_URL', '').replace(/\/+$/, '');
  }
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** Flat per-galon delivery fee (IDR) used when checkout has no routed depot. */
  deliveryFee(depotId: string | null = null): number {
    return this.tunable('deliveryFee', this.num('ORDER_DELIVERY_FEE'), depotId);
  }
  /**
   * Age (minutes) after which an unconfirmed CREATED order is auto-cancelled. The
   * abandoned-order sweep runs platform-wide (no single depot in scope), so this
   * stays a no-arg getter; it still resolves a GLOBAL override through the cache.
   */
  get abandonMinutes(): number {
    return this.tunable('abandonMinutes', this.num('ORDER_ABANDON_MINUTES'));
  }
  /**
   * Age (hours) after which an order still sitting at CONFIRMED/PREPARING is treated as
   * stalled and auto-cancelled, giving back its stock hold. Deliberately far longer than
   * `abandonMinutes`: the depot has already accepted this order, so the sweep must not
   * pull it out from under a depot that is merely slow. Same platform-wide GLOBAL
   * resolution as the abandonment window.
   */
  get stalledHours(): number {
    return this.tunable('stalledHours', this.num('ORDER_STALLED_HOURS'));
  }
  /**
   * Fraction off the subtotal of every subscription delivery (spec 7b). Settings hold
   * whole percent (an operator types "5"); the pricing code wants 0.05. Scoped to the
   * depot the subscription's address routes to — the depot that funds the discount.
   */
  subscriptionDiscountRate(depotId: string | null = null): number {
    return (
      this.tunable(
        'subscriptionDiscountPct',
        this.num('ORDER_SUBSCRIPTION_DISCOUNT_PCT'),
        depotId,
      ) / 100
    );
  }
  /**
   * Express delivery, as the fulfilling depot has it configured. `fee` is charged, not
   * previewed: it used to be a constant in the checkout screen that the customer saw and
   * the order never included.
   */
  express(depotId: string | null = null): {
    enabled: boolean;
    fee: number;
    etaMinMinutes: number;
    etaMaxMinutes: number;
  } {
    return {
      enabled: this.tunable('expressEnabled', this.num('ORDER_EXPRESS_ENABLED'), depotId) === 1,
      fee: this.tunable('expressFee', this.num('ORDER_EXPRESS_FEE'), depotId),
      etaMinMinutes: this.tunable(
        'expressEtaMinMinutes',
        this.num('ORDER_EXPRESS_ETA_MIN_MINUTES'),
        depotId,
      ),
      etaMaxMinutes: this.tunable(
        'expressEtaMaxMinutes',
        this.num('ORDER_EXPRESS_ETA_MAX_MINUTES'),
        depotId,
      ),
    };
  }
  /**
   * Scheduled windows the depot offers, in the order they should be shown. Stored as one
   * comma-separated string because that is what the settings screen can edit; the write
   * path enforces the `HH.MM-HH.MM` shape, so a bad entry never reaches here.
   */
  deliverySlots(depotId: string | null = null): string[] {
    const def = SETTING_DEF_BY_KEY.deliverySlots;
    const raw = this.settings.effective(
      'deliverySlots',
      def.type,
      this.config.getOrThrow<string>('ORDER_DELIVERY_SLOTS'),
      depotId,
    ) as string;
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  /**
   * Nominal galon fill (ml) the water-meter variance is divided by to read as
   * "setara galon". Per-depot: a depot whose main line is 15L counts in 15L units.
   */
  meterReferenceVolumeMl(depotId: string | null = null): number {
    return this.tunable(
      'meterReferenceVolumeMl',
      this.num('ORDER_METER_REFERENCE_VOLUME_ML'),
      depotId,
    );
  }
  /** Litres of meter-vs-sales variance tolerated before the ops alert fires. */
  meterVarianceToleranceLiters(depotId: string | null = null): number {
    return this.tunable(
      'meterVarianceToleranceLiters',
      this.num('ORDER_METER_VARIANCE_TOLERANCE_LITERS'),
      depotId,
    );
  }
  /** Ops number for staff alerts. Blank disables alerting (dev default), never throws. */
  get alertPhone(): string {
    return this.config.get<string>('ORDER_ALERT_PHONE', '');
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
  /**
   * Timezone that decides which calendar day a counter sale belongs to, and therefore
   * whether it can still be voided at the till. Mirrors depot-service's PRICING_TZ: the
   * cashier's day is the depot's day, not UTC's.
   */
  /**
   * Where a voided counter sale's refund is sent. Blank = a counter sale cannot be voided
   * at all, which is the honest failure: without it the order would be marked reversed while
   * payment-service still held the money.
   */
  get paymentServiceUrl(): string {
    return this.config.get<string>('PAYMENT_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /**
   * The one business timezone (H-16). Every day/month boundary this service reckons —
   * the counter void window, the order number's date part, the daily/monthly reports —
   * comes from here, so they cannot disagree about which day it is.
   */
  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', BUSINESS_TIME_ZONE);
  }
}
