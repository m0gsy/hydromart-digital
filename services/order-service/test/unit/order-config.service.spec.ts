import { buildTestConfig } from '../support/fakes';

describe('OrderConfigService', () => {
  it('exposes numeric env as numbers', () => {
    const cfg = buildTestConfig({ ORDER_ABANDON_MINUTES: '30' });
    expect(cfg.port).toBe(3004);
    expect(cfg.deliveryFee()).toBe(5000);
    expect(cfg.abandonMinutes).toBe(30);
    expect(cfg.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('throws when a required numeric key is missing', () => {
    // Blank out the key the sweep needs → getOrThrow raises rather than defaulting.
    expect(
      () => buildTestConfig({ ORDER_ABANDON_MINUTES: undefined as never }).abandonMinutes,
    ).toThrow(/ORDER_ABANDON_MINUTES/);
  });

  it('strips trailing slashes from every service URL', () => {
    const cfg = buildTestConfig({
      PRODUCT_SERVICE_URL: 'http://product:3003/',
      DEPOT_SERVICE_URL: 'http://depot:3007///',
      LOYALTY_SERVICE_URL: 'http://loyalty:3009/',
      PROMO_SERVICE_URL: 'http://promo:3010/',
      REFERRAL_SERVICE_URL: 'http://referral:3011/',
      CRM_SERVICE_URL: 'http://crm:3012/',
      RECOMMENDATION_SERVICE_URL: 'http://reco:3013/',
      FORECAST_SERVICE_URL: 'http://forecast:3014/',
    });
    expect(cfg.productServiceUrl).toBe('http://product:3003');
    expect(cfg.depotServiceUrl).toBe('http://depot:3007');
    expect(cfg.loyaltyServiceUrl).toBe('http://loyalty:3009');
    expect(cfg.promoServiceUrl).toBe('http://promo:3010');
    expect(cfg.referralServiceUrl).toBe('http://referral:3011');
    expect(cfg.crmServiceUrl).toBe('http://crm:3012');
    expect(cfg.recommendationServiceUrl).toBe('http://reco:3013');
    expect(cfg.forecastServiceUrl).toBe('http://forecast:3014');
  });

  // Both are counter-void settings. The timezone decides which calendar day a sale belongs
  // to; the URL decides whether the refund can be made at all.
  it('defaults the counter-void timezone and payment URL, and honours overrides', () => {
    const bare = buildTestConfig();
    expect(bare.businessTimeZone).toBe('Asia/Jakarta');
    expect(bare.paymentServiceUrl).toBe('');

    const set = buildTestConfig({
      PRICING_TZ: 'Asia/Makassar',
      PAYMENT_SERVICE_URL: 'http://payment:3005//',
    });
    expect(set.businessTimeZone).toBe('Asia/Makassar');
    expect(set.paymentServiceUrl).toBe('http://payment:3005');
  });

  it('defaults optional coordination URLs and the internal key to empty', () => {
    const cfg = buildTestConfig();
    expect(cfg.recommendationServiceUrl).toBe('');
    expect(cfg.forecastServiceUrl).toBe('');
    expect(cfg.internalServiceKey).toBe('');
  });

  it('parses NODE_ENV into nodeEnv / isProduction', () => {
    expect(buildTestConfig().nodeEnv).toBe('test');
    expect(buildTestConfig().isProduction).toBe(false);
    expect(buildTestConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('leaves the payout push disabled until its URL is configured', () => {
    expect(buildTestConfig().payoutServiceUrl).toBe('');
    expect(buildTestConfig({ PAYOUT_SERVICE_URL: 'http://payout:3016/' }).payoutServiceUrl).toBe(
      'http://payout:3016',
    );
  });

  it('splits, trims and drops empty CORS origins', () => {
    const cfg = buildTestConfig({
      CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com ,, http://c.com',
    });
    expect(cfg.corsOrigins).toEqual(['http://a.com', 'http://b.com', 'http://c.com']);
  });

  // Both meter tunables, in both shapes: the network default and an explicit depot. A depot
  // whose main line is 15L counts its variance in 15L units, not the network's 19L.
  it('resolves the meter tunables per depot and network-wide', () => {
    const cfg = buildTestConfig({
      ORDER_METER_REFERENCE_VOLUME_ML: '19000',
      ORDER_METER_VARIANCE_TOLERANCE_LITERS: '200',
    });
    expect(cfg.meterReferenceVolumeMl()).toBe(19000);
    expect(cfg.meterReferenceVolumeMl('depot-1')).toBe(19000);
    expect(cfg.meterVarianceToleranceLiters()).toBe(200);
    expect(cfg.meterVarianceToleranceLiters('depot-1')).toBe(200);
  });

  // A1's kill switch. `SettingType` has no boolean, so it is an int pinned to 0/1 and the
  // getter is what turns it back into one — including the "off" reading, which is the only
  // reading anyone will reach for in an incident.
  it('reads the cart depot-pricing switch on and off, per depot and network-wide', () => {
    const on = buildTestConfig({ ORDER_CART_DEPOT_PRICING: '1' });
    expect(on.cartDepotPricing()).toBe(true);
    expect(on.cartDepotPricing('depot-1')).toBe(true);

    const off = buildTestConfig({ ORDER_CART_DEPOT_PRICING: '0' });
    expect(off.cartDepotPricing()).toBe(false);
    expect(off.cartDepotPricing('depot-1')).toBe(false);
  });
});
