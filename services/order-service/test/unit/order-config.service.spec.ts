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
    expect(bare.counterVoidTimeZone).toBe('Asia/Jakarta');
    expect(bare.paymentServiceUrl).toBe('');

    const set = buildTestConfig({
      PRICING_TZ: 'Asia/Makassar',
      PAYMENT_SERVICE_URL: 'http://payment:3005//',
    });
    expect(set.counterVoidTimeZone).toBe('Asia/Makassar');
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
});
