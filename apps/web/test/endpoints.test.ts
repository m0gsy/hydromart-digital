/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

describe('endpoints', () => {
  it('routes every path through the gateway service segment + /api/v1', () => {
    expect(endpoints.auth.verifyOtp).toBe('/auth/api/v1/auth/otp/verify');
    expect(endpoints.cart.item('p1')).toBe('/orders/api/v1/cart/items/p1');
    expect(endpoints.orders.cancel('o1')).toBe('/orders/api/v1/orders/o1/cancel');
    expect(endpoints.payments.forOrder('o1')).toBe('/payments/api/v1/payments?orderId=o1');
  });

  it('builds a product browse query, omitting empty params', () => {
    expect(endpoints.products.browse({})).toBe('/products/api/v1/products');
    expect(endpoints.products.browse({ page: 2, limit: 12, search: 'galon' })).toBe(
      '/products/api/v1/products?page=2&limit=12&search=galon',
    );
  });

  it('opens a depot stock line on the depot-scoped path', () => {
    expect(endpoints.inventory.create('d1')).toBe('/depots/api/v1/depots/d1/inventory');
  });

  // Both hang off the line id, not the depot: a line is only ever addressed by its own id.
  it('addresses one stock line for delete and reservation drill-down', () => {
    expect(endpoints.inventory.remove('i1')).toBe('/depots/api/v1/inventory/i1');
    expect(endpoints.inventory.reservations('i1')).toBe(
      '/depots/api/v1/inventory/i1/reservations',
    );
  });

  // The console's list. Same query, different path: this one keeps deactivated products,
  // which is the only way a console can switch one back on.
  it('builds the admin product browse on its own path', () => {
    expect(endpoints.products.browseAll({})).toBe('/products/api/v1/products/all');
    expect(endpoints.products.browseAll({ limit: 100 })).toBe(
      '/products/api/v1/products/all?limit=100',
    );
  });

  it('routes the Release 2 loyalty/voucher/referral paths through the gateway', () => {
    expect(endpoints.loyalty.me()).toBe('/loyalty/api/v1/loyalty/me');
    expect(endpoints.loyalty.me('d 1')).toBe('/loyalty/api/v1/loyalty/me?depotId=d%201');
    expect(endpoints.loyalty.tiers()).toBe('/loyalty/api/v1/loyalty/tiers');
    expect(endpoints.loyalty.tiers(null)).toBe('/loyalty/api/v1/loyalty/tiers');
    expect(endpoints.loyalty.tiers('d1')).toBe('/loyalty/api/v1/loyalty/tiers?depotId=d1');
    // The one public write in depot-service: a prospective partner applying.
    expect(endpoints.franchiseApps.submit).toBe('/depots/api/v1/franchise-applications');
    // Category admin: the shop's list is active-only, the console's is not.
    expect(endpoints.products.categories).toBe('/products/api/v1/categories');
    expect(endpoints.products.categoriesAll).toBe('/products/api/v1/categories/all');
    expect(endpoints.products.category('c1')).toBe('/products/api/v1/categories/c1');
    // The subscription saving is per-depot too, and quoted before sign-in.
    expect(endpoints.subscriptions.discount()).toBe('/orders/api/v1/subscriptions/discount');
    expect(endpoints.subscriptions.discount(null)).toBe('/orders/api/v1/subscriptions/discount');
    expect(endpoints.subscriptions.discount('d 1')).toBe(
      '/orders/api/v1/subscriptions/discount?depotId=d%201',
    );
    expect(endpoints.loyalty.transactions({ limit: 10 })).toBe(
      '/loyalty/api/v1/loyalty/me/transactions?limit=10',
    );
    expect(endpoints.loyalty.transactions()).toBe('/loyalty/api/v1/loyalty/me/transactions');
    expect(endpoints.vouchers.quote).toBe('/vouchers/api/v1/vouchers/quote');
    expect(endpoints.referrals.me).toBe('/referrals/api/v1/referrals/me');
    expect(endpoints.referrals.redeem).toBe('/referrals/api/v1/referrals');
    expect(endpoints.promotions.analytics('promo-1')).toBe(
      '/vouchers/api/v1/promotions/promo-1/analytics',
    );
  });

  it('builds the staff order queue path with filters', () => {
    expect(endpoints.orders.manage()).toBe('/orders/api/v1/orders/manage');
    expect(endpoints.orders.manage({ status: 'CREATED', limit: 50 })).toBe(
      '/orders/api/v1/orders/manage?limit=50&status=CREATED',
    );
    expect(endpoints.orders.status('o1')).toBe('/orders/api/v1/orders/o1/status');
  });

  it('builds the dashboard executive path with an optional date range', () => {
    expect(endpoints.dashboard.executive()).toBe('/dashboard/api/v1/dashboard/executive');
    expect(endpoints.dashboard.executive({ from: '2026-06-01', to: '2026-07-01' })).toBe(
      '/dashboard/api/v1/dashboard/executive?from=2026-06-01&to=2026-07-01',
    );
  });

  it('builds the dashboard franchise path with an optional date range', () => {
    expect(endpoints.dashboard.franchise()).toBe('/dashboard/api/v1/dashboard/franchise');
    expect(endpoints.dashboard.franchise({ from: '2026-06-01', to: '2026-07-01' })).toBe(
      '/dashboard/api/v1/dashboard/franchise?from=2026-06-01&to=2026-07-01',
    );
  });

  it('builds the depot-scoped operational monthly P&L path', () => {
    expect(endpoints.dashboard.monthlyPnl('d1', '2026-07')).toBe(
      '/dashboard/api/v1/dashboard/monthly-pnl?depotId=d1&month=2026-07',
    );
  });

  it('builds the forecast demand + depot rollup paths, omitting unset params', () => {
    expect(endpoints.forecast.demand({ productId: 'p1' })).toBe(
      '/forecast/api/v1/forecast/demand?productId=p1',
    );
    expect(
      endpoints.forecast.demand({ productId: 'p1', depotId: 'd1', historyDays: 60, horizonDays: 14 }),
    ).toBe('/forecast/api/v1/forecast/demand?productId=p1&depotId=d1&historyDays=60&horizonDays=14');
    expect(endpoints.forecast.depot('d1')).toBe('/forecast/api/v1/forecast/depot/d1');
    expect(endpoints.forecast.depot('d1', { historyDays: 30, horizonDays: 7, limit: 50 })).toBe(
      '/forecast/api/v1/forecast/depot/d1?historyDays=30&horizonDays=7&limit=50',
    );
  });

  it('builds the forecast sales + churn paths, omitting unset params', () => {
    expect(endpoints.forecast.sales()).toBe('/forecast/api/v1/forecast/sales');
    expect(endpoints.forecast.sales({ depotId: 'd1', historyDays: 60, horizonDays: 14 })).toBe(
      '/forecast/api/v1/forecast/sales?depotId=d1&historyDays=60&horizonDays=14',
    );
    expect(endpoints.forecast.churn()).toBe('/forecast/api/v1/forecast/churn');
    expect(endpoints.forecast.churn({ depotId: 'd1', limit: 100, days: 45 })).toBe(
      '/forecast/api/v1/forecast/churn?depotId=d1&limit=100&days=45',
    );
  });

  it('builds the driver delivery paths', () => {
    expect(endpoints.deliveries.driver.list()).toBe('/deliveries/api/v1/driver/deliveries');
    expect(endpoints.deliveries.driver.list('ON_DELIVERY')).toBe(
      '/deliveries/api/v1/driver/deliveries?status=ON_DELIVERY',
    );
    expect(endpoints.deliveries.driver.get('d1')).toBe('/deliveries/api/v1/driver/deliveries/d1');
    expect(endpoints.deliveries.driver.pickup('d1')).toBe(
      '/deliveries/api/v1/driver/deliveries/d1/pickup',
    );
    expect(endpoints.deliveries.driver.start('d1')).toBe(
      '/deliveries/api/v1/driver/deliveries/d1/start',
    );
    expect(endpoints.deliveries.driver.complete('d1')).toBe(
      '/deliveries/api/v1/driver/deliveries/d1/complete',
    );
    expect(endpoints.deliveries.driver.fail('d1')).toBe(
      '/deliveries/api/v1/driver/deliveries/d1/fail',
    );
    expect(endpoints.deliveries.driver.location('d1')).toBe(
      '/deliveries/api/v1/driver/deliveries/d1/location',
    );
  });

  it('builds the depot-team report window', () => {
    expect(
      endpoints.deliveries.depotTeam('d1', {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).toBe(
      '/deliveries/api/v1/reports/depot-team?depotId=d1&from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z',
    );
  });

  it('builds the driver shift paths', () => {
    expect(endpoints.deliveries.shifts.current).toBe('/deliveries/api/v1/driver/shifts/current');
    expect(endpoints.deliveries.shifts.checkIn).toBe('/deliveries/api/v1/driver/shifts/check-in');
    expect(endpoints.deliveries.shifts.checkOut('s1')).toBe(
      '/deliveries/api/v1/driver/shifts/s1/check-out',
    );
    expect(endpoints.deliveries.shifts.status('s1')).toBe(
      '/deliveries/api/v1/driver/shifts/s1/status',
    );
  });

  it('builds the depot + inventory staff paths', () => {
    expect(endpoints.depots.browse({ limit: 100 })).toBe('/depots/api/v1/depots?limit=100');
    expect(endpoints.inventory.lines('d1')).toBe('/depots/api/v1/depots/d1/inventory');
    expect(endpoints.inventory.lines('d1', { lowStockOnly: true })).toBe(
      '/depots/api/v1/depots/d1/inventory?lowStockOnly=true',
    );
    expect(endpoints.inventory.adjust('i1')).toBe('/depots/api/v1/inventory/i1/adjust');
    expect(endpoints.inventory.opname('i1')).toBe('/depots/api/v1/inventory/i1/opname');
    expect(endpoints.inventory.update('i1')).toBe('/depots/api/v1/inventory/i1');
    expect(
      endpoints.inventory.depotMovements('d1', {
        type: 'SALE',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
        page: 2,
        limit: 50,
      }),
    ).toBe(
      '/depots/api/v1/depots/d1/inventory/movements?type=SALE&from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z&page=2&limit=50',
    );
  });
  /*
   * D-16. Nine paths came in with this release and none was asserted here. Every one of
   * them is checked against a real `@Controller` route by `scripts/check-endpoint-contracts.mjs`
   * with an EMPTY allowlist, so a typo is a CI failure rather than a 404 somebody finds in
   * a browser — but these hold the shape the gateway needs: `/{segment}/api/v1/...`.
   */
  it('builds the staff-lifecycle paths this release added', () => {
    expect(endpoints.auth.setStaffDepot('s1')).toBe('/auth/api/v1/auth/staff/s1/depot');
    expect(endpoints.auth.setStaffActive('s1')).toBe('/auth/api/v1/auth/staff/s1/status');
    expect(endpoints.auth.deleteStaff('s1')).toBe('/auth/api/v1/auth/staff/s1');
    expect(endpoints.hr.createEmployeeAccount('e1')).toBe(
      '/employees/api/v1/employees/e1/account',
    );
  });

  it('builds the daily-close paths, with the business date on the read', () => {
    expect(endpoints.depots.dailyClose('d1', '2026-08-04')).toBe(
      '/depots/api/v1/depots/d1/daily-close?businessDate=2026-08-04',
    );
    expect(endpoints.depots.closeDay('d1')).toBe('/depots/api/v1/depots/d1/daily-close');
    expect(endpoints.depots.reopenDay('d1')).toBe('/depots/api/v1/depots/d1/daily-close/reopen');
  });

  // `from` is never optional: the service filters on checkInAt with no default window, so
  // an unbounded call would scan every shift ever recorded.
  it('always bounds the dispatch shift read, and scopes it when asked', () => {
    expect(endpoints.deliveries.shiftsOnDuty('2026-08-04T00:00:00.000Z')).toBe(
      '/deliveries/api/v1/shifts?from=2026-08-04T00%3A00%3A00.000Z',
    );
    expect(endpoints.deliveries.shiftsOnDuty('2026-08-04T00:00:00.000Z', 'd1')).toBe(
      '/deliveries/api/v1/shifts?from=2026-08-04T00%3A00%3A00.000Z&depotId=d1',
    );
  });

  it('exports the daily report on the same path family as the report itself', () => {
    expect(endpoints.reports.depotDailyExport('d1')).toBe(
      '/orders/api/v1/reports/depot-daily/export?depotId=d1',
    );
    expect(endpoints.reports.depotDailyExport('d1', '2026-08-04')).toBe(
      '/orders/api/v1/reports/depot-daily/export?depotId=d1&date=2026-08-04',
    );
  });
});

/*
 * Audit F: 24 entries in this table had no caller anywhere in the app. Some were features
 * that never got built, some were routes a screen was supposed to reach and never did —
 * and from the table alone the two are indistinguishable, which is how three years of
 * "subscriptions.pause" sat there while customers could not pause a subscription.
 *
 * This walks the REAL object (not a regex over the source, which cannot see nested groups
 * or tell an entry from a builder's `q` parameter) and fails on any entry nothing calls.
 * Add an entry only together with the screen that uses it.
 */
describe('every endpoint entry has a caller', () => {
  /** `group.key` for every leaf, however deeply the tables nest them. */
  function leafPaths(node: unknown, trail: string[] = []): string[] {
    if (typeof node !== 'object' || node === null) return [trail.join('.')];
    return Object.entries(node).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? leafPaths(v, [...trail, k])
        : [[...trail, k].join('.')],
    );
  }

  /*
   * Read through Vite rather than `node:fs`: a filesystem walk depends on the runner's cwd,
   * and a wrong cwd reads nothing and reports EVERY entry as uncalled — loud, but for the
   * wrong reason. `import.meta.glob` is resolved at transform time against this file.
   */
  const sources = import.meta.glob('../src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('is called from somewhere in apps/web', () => {
    const blob = Object.entries(sources)
      .filter(([path]) => !path.includes('/lib/endpoints/'))
      .map(([, text]) => text)
      .join('\n');
    // Guard the guard: an empty blob would pass every entry as uncalled.
    expect(blob.length).toBeGreaterThan(100_000);

    /*
     * A group reached by a COMPUTED key — `endpoints.subscriptions[action](id)` — puts every
     * key of that group beyond the reach of a name search. The audit that prompted this test
     * read `subscriptions.pause/resume/cancel` as dead for exactly that reason; they are
     * called from `app/subscriptions/page.tsx:286,290,319` and always were. A check that
     * cannot see a call site is a check that asks you to delete working code.
     */
    const computed = new Set(
      [...blob.matchAll(/\b(?:endpoints\.)?(\w+)\s*\[/g)].map((m) => m[1]),
    );

    // The last two segments are enough: entries are reached as `endpoints.group.key`, and
    // are often destructured to `group.key` first.
    const uncalled = leafPaths(endpoints).filter((path) => {
      const segments = path.split('.');
      if (segments.some((s) => computed.has(s))) return false;
      const tail = segments.slice(-2).join('\\.');
      return !new RegExp(`\\b${tail}\\b`).test(blob);
    });

    expect(uncalled).toEqual([]);
  });
});

/**
 * E3: `api.ts` now refuses a path with an empty segment, because a detail screen opened
 * without its `?id=` used to build one and get a misleading 404 back. That guard would
 * be a new way to break a screen if any endpoint legitimately ended in `/`, so this
 * asserts none does — and fails the moment somebody adds one, which is cheaper than
 * finding it in production.
 */
describe('E3 · no endpoint path can be mistaken for one with a hole in it', () => {
  const files = import.meta.glob('../src/lib/endpoints/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('reads the endpoint modules at all (guards against an empty glob)', () => {
    expect(Object.keys(files).length).toBeGreaterThan(5);
  });

  it('no path literal ends in "/" or contains "//"', () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(files)) {
      source.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        for (const match of line.matchAll(/(['"`])((?:\.|(?!\1).)*)\1/g)) {
          const value = match[2] ?? '';
          if (!value.startsWith('/')) continue;
          const beforeQuery = value.split('?')[0] ?? '';
          if (beforeQuery.length > 1 && beforeQuery.endsWith('/')) {
            offenders.push(`${file}:${i + 1} ends in "/": ${value}`);
          }
          if (beforeQuery.includes('//')) offenders.push(`${file}:${i + 1} has "//": ${value}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
