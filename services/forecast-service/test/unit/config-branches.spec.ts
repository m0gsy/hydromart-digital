import { ForecastConfigService } from '../../src/config/forecast-config.service';

// Exercises every ForecastConfigService getter (num/getOrThrow/get-with-default paths,
// url trailing-slash strip, corsOrigins split+trim+filter) against a fake ConfigService.

type Store = Record<string, unknown>;

function makeConfig(store: Store) {
  return {
    get: <T>(key: string, fallback?: T): T => (key in store ? (store[key] as T) : (fallback as T)),
    getOrThrow: <T>(key: string): T => {
      if (!(key in store)) throw new Error(`missing ${key}`);
      return store[key] as T;
    },
  };
}

function service(store: Store): ForecastConfigService {
  return new ForecastConfigService(makeConfig(store) as never);
}

describe('ForecastConfigService', () => {
  it('reads defaults when nothing is set', () => {
    const cfg = service({});
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.isProduction).toBe(false);
    expect(cfg.internalServiceKey).toBe('');
    expect(cfg.orderServiceUrl).toBe('');
    expect(cfg.depotServiceUrl).toBe('');
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000']);
    expect(cfg.churnWindowDays).toBe(45);
    expect(cfg.churnMonetaryRef).toBe(500_000);
  });

  it('reflects production and reads required + numeric values', () => {
    const cfg = service({
      NODE_ENV: 'production',
      FORECAST_SERVICE_PORT: '3011',
      FORECAST_DATABASE_URL: 'postgres://db',
      JWT_ACCESS_SECRET: 'secret',
      INTERNAL_SERVICE_KEY: 'ikey',
      RATE_LIMIT_TTL_SECONDS: '60',
      RATE_LIMIT_MAX: '100',
      CHURN_WINDOW_DAYS: 30,
      CHURN_MONETARY_REF_RUPIAH: 250_000,
    });
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.isProduction).toBe(true);
    expect(cfg.port).toBe(3011);
    expect(cfg.databaseUrl).toBe('postgres://db');
    expect(cfg.jwtAccessSecret).toBe('secret');
    expect(cfg.internalServiceKey).toBe('ikey');
    expect(cfg.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
    expect(cfg.churnWindowDays).toBe(30);
    expect(cfg.churnMonetaryRef).toBe(250_000);
  });

  it('strips trailing slashes from service URLs', () => {
    const cfg = service({ ORDER_SERVICE_URL: 'http://order:3005///', DEPOT_SERVICE_URL: 'http://depot:3007/' });
    expect(cfg.orderServiceUrl).toBe('http://order:3005');
    expect(cfg.depotServiceUrl).toBe('http://depot:3007');
  });

  it('splits, trims and drops blank CORS origins', () => {
    const cfg = service({ CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com , ,' });
    expect(cfg.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });

  it('throws for a missing required numeric/string key', () => {
    expect(() => service({}).port).toThrow(/FORECAST_SERVICE_PORT/);
    expect(() => service({}).databaseUrl).toThrow(/FORECAST_DATABASE_URL/);
  });
});
