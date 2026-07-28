import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { LoyaltyConfigService } from '../../src/config/loyalty-config.service';
import { envValidationSchema } from '../../src/config/env.validation';

// Exercises the plain env-backed getters on LoyaltyConfigService (the business tunables
// are covered elsewhere) plus the env validation schema module.

function config(env: Record<string, string>): LoyaltyConfigService {
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new LoyaltyConfigService(
    fake as unknown as ConfigService,
    new SettingsCache({ loadAll: async () => [] }),
  );
}

describe('LoyaltyConfigService env getters', () => {
  it('nodeEnv falls back to development and isProduction is false', () => {
    const svc = config({});
    expect(svc.nodeEnv).toBe('development');
    expect(svc.isProduction).toBe(false);
  });

  it('isProduction is true in production', () => {
    expect(config({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('port reads the numeric port', () => {
    expect(config({ LOYALTY_SERVICE_PORT: '3009' }).port).toBe(3009);
  });

  it('corsOrigins splits, trims, and drops blank entries', () => {
    const svc = config({ CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com , ,' });
    expect(svc.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });

  it('corsOrigins uses the localhost default when unset', () => {
    expect(config({}).corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('rateLimit reads ttl + max', () => {
    expect(config({ RATE_LIMIT_TTL_SECONDS: '30', RATE_LIMIT_MAX: '77' }).rateLimit).toEqual({
      ttlSeconds: 30,
      limit: 77,
    });
  });

  it('customerServiceUrl strips trailing slashes and defaults to blank', () => {
    expect(config({ CUSTOMER_SERVICE_URL: 'http://customer:3002///' }).customerServiceUrl).toBe(
      'http://customer:3002',
    );
    expect(config({}).customerServiceUrl).toBe('');
  });

  it('internalServiceKey reads the shared secret, blank by default', () => {
    expect(config({ INTERNAL_SERVICE_KEY: 'secret-key-abcdef' }).internalServiceKey).toBe(
      'secret-key-abcdef',
    );
    expect(config({}).internalServiceKey).toBe('');
  });
});

describe('envValidationSchema', () => {
  it('applies defaults for a minimal valid env', () => {
    const { error, value } = envValidationSchema.validate({
      LOYALTY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
    });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.LOYALTY_SERVICE_PORT).toBe(3009);
    expect(value.LOYALTY_EARN_RATE_RUPIAH).toBe(1000);
  });

  it('rejects a missing required database url', () => {
    const { error } = envValidationSchema.validate({ JWT_ACCESS_SECRET: 'a'.repeat(40) });
    expect(error).toBeDefined();
  });
});
