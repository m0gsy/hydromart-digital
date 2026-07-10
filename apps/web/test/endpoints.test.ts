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
  });

  it('builds the dashboard executive path with an optional date range', () => {
    expect(endpoints.dashboard.executive()).toBe('/dashboard/api/v1/dashboard/executive');
    expect(endpoints.dashboard.executive({ from: '2026-06-01', to: '2026-07-01' })).toBe(
      '/dashboard/api/v1/dashboard/executive?from=2026-06-01&to=2026-07-01',
    );
  });
});
