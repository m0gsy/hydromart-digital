import type { ConfigService } from '@nestjs/config';

import { PayoutConfigService } from '../src/config/payout-config.service';
import { envValidationSchema } from '../src/config/env.validation';

// Thin ConfigService fake: get(key, default) + getOrThrow(key). The config is a money
// boundary (auto-approve threshold, commission rate) so the parsing is worth pinning.
class FakeConfig {
  constructor(private readonly map: Record<string, string>) {}
  get<T>(key: string, def?: T): T {
    return (this.map[key] as unknown as T) ?? (def as T);
  }
  getOrThrow(key: string): string {
    const v = this.map[key];
    if (v === undefined) throw new Error(`missing ${key}`);
    return v;
  }
}

const make = (map: Record<string, string>) =>
  new PayoutConfigService(new FakeConfig(map) as unknown as ConfigService);

describe('PayoutConfigService', () => {
  it('reads numeric settings via getOrThrow', () => {
    const cfg = make({
      PAYOUT_SERVICE_PORT: '3016',
      RATE_LIMIT_TTL_SECONDS: '60',
      RATE_LIMIT_MAX: '100',
      EXPENSE_AUTO_APPROVE_MAX_IDR: '50000',
    });
    expect(cfg.port).toBe(3016);
    expect(cfg.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
    expect(cfg.expenseAutoApproveMaxIdr).toBe(50000);
  });

  it('throws when a required numeric setting is absent', () => {
    expect(() => make({}).port).toThrow(/missing PAYOUT_SERVICE_PORT/);
  });

  it('derives nodeEnv/isProduction, defaulting to development', () => {
    expect(make({}).nodeEnv).toBe('development');
    expect(make({}).isProduction).toBe(false);
    expect(make({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('splits, trims and drops empty CORS origins', () => {
    const cfg = make({ CORS_ALLOWED_ORIGINS: 'https://a.id , https://b.id ,' });
    expect(cfg.corsOrigins).toEqual(['https://a.id', 'https://b.id']);
  });

  it('falls back to the localhost CORS default', () => {
    expect(make({}).corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('parses the commission rate, defaulting to 5%', () => {
    expect(make({}).commissionRate).toBe(0.05);
    expect(make({ PAYOUT_COMMISSION_RATE: '0.12' }).commissionRate).toBe(0.12);
  });
});

describe('envValidationSchema', () => {
  const base = {
    PAYOUT_DATABASE_URL: 'postgres://user:pass@localhost:5432/payout',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('accepts a minimal env and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(base, { allowUnknown: true });
    expect(error).toBeUndefined();
    expect(value.PAYOUT_SERVICE_PORT).toBe(3016);
    expect(value.EXPENSE_AUTO_APPROVE_MAX_IDR).toBe(50000);
    expect(value.NODE_ENV).toBe('development');
  });

  it('rejects a non-postgres database url', () => {
    const { error } = envValidationSchema.validate(
      { ...base, PAYOUT_DATABASE_URL: 'mysql://localhost/db' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });

  it('requires the database url', () => {
    const { error } = envValidationSchema.validate(
      { JWT_ACCESS_SECRET: 'x'.repeat(32) },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });
});
