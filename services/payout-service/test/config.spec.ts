import type { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { PayoutConfigService } from '../src/config/payout-config.service';
import { envValidationSchema } from '../src/config/env.validation';

// Empty-repo cache: every effective() falls through to the getter's own env read.
const emptyCache = () => new SettingsCache({ loadAll: async () => [] });

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
  new PayoutConfigService(new FakeConfig(map) as unknown as ConfigService, emptyCache());

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
    expect(cfg.expenseAutoApproveMaxIdr()).toBe(50000);
  });

  /*
   * CA-4-21, owner decision 2026-09-04: Rp 50.000 is the NETWORK ceiling and a depot may
   * only LOWER it.
   *
   * Without the clamp, `effective()` serves whatever the depot row says — and a MANAGER
   * holds `depotAdmin` and `expenseApprove` both, so the same person could raise their own
   * depot's bar to Rp 5.000.000 and then have nothing left to approve.
   */
  describe('auto-approve ceiling (CA-4-21)', () => {
    // The cache reads rows lazily, so it is refreshed once before the getter is asked.
    const withSettings = async (
      rows: { scope: string; depotId: string | null; key: string; value: string }[],
    ) => {
      const cache = new SettingsCache({ loadAll: async () => rows as never });
      await cache.refresh();
      return new PayoutConfigService(
        new FakeConfig({ EXPENSE_AUTO_APPROVE_MAX_IDR: '50000' }) as unknown as ConfigService,
        cache,
      );
    };

    const DEPOT = 'dep-1';

    it('lets a depot lower it', async () => {
      const cfg = await withSettings([
        { scope: 'DEPOT', depotId: DEPOT, key: 'expenseAutoApproveMaxIdr', value: '20000' },
      ]);
      expect(cfg.expenseAutoApproveMaxIdr(DEPOT)).toBe(20000);
    });

    it('refuses to let a depot raise it above the network figure', async () => {
      const cfg = await withSettings([
        { scope: 'DEPOT', depotId: DEPOT, key: 'expenseAutoApproveMaxIdr', value: '5000000' },
      ]);
      expect(cfg.expenseAutoApproveMaxIdr(DEPOT)).toBe(50000);
    });

    it('measures the ceiling against head office, not against the depot itself', async () => {
      const cfg = await withSettings([
        { scope: 'GLOBAL', depotId: null, key: 'expenseAutoApproveMaxIdr', value: '30000' },
        { scope: 'DEPOT', depotId: DEPOT, key: 'expenseAutoApproveMaxIdr', value: '45000' },
      ]);
      expect(cfg.expenseAutoApproveMaxIdr(null)).toBe(30000);
      expect(cfg.expenseAutoApproveMaxIdr(DEPOT)).toBe(30000);
    });
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

  // H-16: one business timezone for the platform. Unset must land on WIB — an unset
  // PRICING_TZ used to mean UTC, which is a seven-hour error in every day boundary.
  it('defaults the business timezone to WIB and honours an override', () => {
    expect(make({}).businessTimeZone).toBe('Asia/Jakarta');
    expect(make({ PRICING_TZ: 'Asia/Makassar' }).businessTimeZone).toBe('Asia/Makassar');
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
