import { ConfigService } from '@nestjs/config';

import { GatewayConfigService } from '../../src/config/gateway-config.service';

// Minimal ConfigService double: get(key, default) and getOrThrow(key).
function makeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, def?: unknown) => (key in values ? values[key] : def),
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

const ALL_UPSTREAMS: Record<string, string> = {
  AUTH_SERVICE_URL: 'http://auth:1/',
  CUSTOMER_SERVICE_URL: 'http://customer:1',
  PRODUCT_SERVICE_URL: 'http://product:1',
  ORDER_SERVICE_URL: 'http://order:1',
  PAYMENT_SERVICE_URL: 'http://payment:1',
  DELIVERY_SERVICE_URL: 'http://delivery:1',
  DEPOT_SERVICE_URL: 'http://depot:1',
  DASHBOARD_SERVICE_URL: 'http://dashboard:1',
  LOYALTY_SERVICE_URL: 'http://loyalty:1',
  PROMO_SERVICE_URL: 'http://promo:1',
  REFERRAL_SERVICE_URL: 'http://referral:1',
  CRM_SERVICE_URL: 'http://crm:1',
  RECOMMENDATION_SERVICE_URL: 'http://reco:1',
  FORECAST_SERVICE_URL: 'http://forecast:1',
  PAYOUT_SERVICE_URL: 'http://payout:1',
  ADMIN_SERVICE_URL: 'http://admin:1',
  HR_SERVICE_URL: 'http://hr:1',
};

const BASE = {
  ...ALL_UPSTREAMS,
  GATEWAY_PORT: '8080',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_OTP_MAX: '20',
};

describe('GatewayConfigService', () => {
  it('exposes port as a number', () => {
    expect(new GatewayConfigService(makeConfig(BASE)).port).toBe(8080);
  });

  it('defaults nodeEnv to development and reports isProduction false', () => {
    const svc = new GatewayConfigService(makeConfig(BASE));
    expect(svc.nodeEnv).toBe('development');
    expect(svc.isProduction).toBe(false);
  });

  it('reports isProduction true when NODE_ENV=production', () => {
    const svc = new GatewayConfigService(makeConfig({ ...BASE, NODE_ENV: 'production' }));
    expect(svc.isProduction).toBe(true);
  });

  it('splits, trims and drops empty CORS origins', () => {
    const svc = new GatewayConfigService(
      makeConfig({ ...BASE, CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com , ' }),
    );
    expect(svc.corsOrigins).toEqual([
      'http://a.com',
      'http://b.com',
      'https://localhost',
      'capacitor://localhost',
    ]);
  });

  it('defaults CORS origins when unset', () => {
    expect(new GatewayConfigService(makeConfig(BASE)).corsOrigins).toEqual([
      'http://localhost:3000',
      'https://localhost',
      'capacitor://localhost',
    ]);
  });

  // F2: the shipped app is served from `https://localhost`, so it is always allowed —
  // an env var that has to be edited by hand on the VPS is an env var that gets
  // forgotten, and the failure mode is every request from the app failing CORS.
  it('never duplicates a native origin the env already listed', () => {
    const svc = new GatewayConfigService(
      makeConfig({ ...BASE, CORS_ALLOWED_ORIGINS: 'https://localhost, http://a.com' }),
    );
    expect(svc.corsOrigins).toEqual(['https://localhost', 'http://a.com', 'capacitor://localhost']);
  });

  it('reads the rate-limit config as numbers', () => {
    expect(new GatewayConfigService(makeConfig(BASE)).rateLimit).toEqual({
      ttlSeconds: 60,
      limit: 100,
      // Its own ceiling: past this one every request is a paid SMS, not a CPU cycle.
      otpLimit: 20,
    });
  });

  // F5: the kill switch is an env edit and a restart — no rebuild, no Play review. It is
  // off (0) unless somebody turns it on, which is how it will normally sit.
  it('reads the mobile version gate, defaulting to off', () => {
    expect(new GatewayConfigService(makeConfig(BASE)).mobile).toEqual({
      minVersionCode: 0,
      updateMessage: '',
    });
  });

  it('reads a configured minimum version and trims its message', () => {
    const svc = new GatewayConfigService(
      makeConfig({
        ...BASE,
        MOBILE_MIN_VERSION_CODE: '42',
        MOBILE_UPDATE_MESSAGE: '  Perbarui.  ',
      }),
    );
    expect(svc.mobile).toEqual({ minVersionCode: 42, updateMessage: 'Perbarui.' });
  });

  it('maps every segment to its upstream and strips trailing slashes', () => {
    const map = new GatewayConfigService(makeConfig(BASE)).upstreams();
    expect(map.auth).toBe('http://auth:1'); // trailing slash stripped
    expect(map.customers).toBe('http://customer:1');
    // depot-service is reused across several public segments
    expect(map.incidents).toBe('http://depot:1');
    expect(map.approvals).toBe('http://depot:1');
    expect(map.procurement).toBe('http://depot:1');
    expect(map.shifts).toBe('http://depot:1');
    // hr-service backs many segments
    expect(map.employees).toBe('http://hr:1');
    expect(map['hr-reports']).toBe('http://hr:1');
    // Kasbon and the bonus-rule engine: the console calls both through the gateway.
    expect(map.loans).toBe('http://hr:1');
    expect(map['bonus-rules']).toBe('http://hr:1');
  });

  it('throws when a required upstream env var is missing', () => {
    const missingAuth: Record<string, string> = { ...BASE };
    delete missingAuth.AUTH_SERVICE_URL;
    expect(() => new GatewayConfigService(makeConfig(missingAuth)).upstreams()).toThrow(
      /AUTH_SERVICE_URL/,
    );
  });
});
