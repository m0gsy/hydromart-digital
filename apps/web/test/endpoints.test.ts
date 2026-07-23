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

  it('routes the Release 2 loyalty/voucher/referral paths through the gateway', () => {
    expect(endpoints.loyalty.me).toBe('/loyalty/api/v1/loyalty/me');
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
});
