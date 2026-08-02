import { randomUUID } from 'node:crypto';

import { HTTP_STATUS } from '@hydromart/platform';

import { OrderConfigService } from '../../src/config/order-config.service';
import { InsufficientStockError, VoucherRejectedError } from '../../src/domain/errors';
import type { OrderRecord } from '../../src/application/ports/order.repository';
import { InventoryHttpAdapter } from '../../src/infrastructure/http/inventory.http.adapter';
import { DepotDirectoryHttpAdapter } from '../../src/infrastructure/http/depot-directory.http.adapter';
import { DepotPricingHttpAdapter } from '../../src/infrastructure/http/depot-pricing.http.adapter';
import { ForecastCoordinationHttpAdapter } from '../../src/infrastructure/http/forecast-coordination.http.adapter';
import { LoyaltyCoordinationHttpAdapter } from '../../src/infrastructure/http/loyalty-coordination.http.adapter';
import { MembershipHttpAdapter } from '../../src/infrastructure/http/membership.http.adapter';
import { NotificationHttpAdapter } from '../../src/infrastructure/http/notification.http.adapter';
import { ProductCatalogHttpAdapter } from '../../src/infrastructure/http/product-catalog.http.adapter';
import { PromoHttpAdapter } from '../../src/infrastructure/http/promo.http.adapter';
import { ReferralCoordinationHttpAdapter } from '../../src/infrastructure/http/referral-coordination.http.adapter';
import { RecommendationCoordinationHttpAdapter } from '../../src/infrastructure/http/recommendation-coordination.http.adapter';
import { FranchiseRevenueHttpAdapter } from '../../src/infrastructure/http/franchise-revenue.http.adapter';

// These specs exercise the REAL HTTP adapter code (URL building, headers, res.ok
// branches, fail-open catch, response parsing) against a mocked global.fetch — the
// units the e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): OrderConfigService {
  return {
    productServiceUrl: 'http://product:3003',
    depotServiceUrl: 'http://depot:3007',
    loyaltyServiceUrl: 'http://loyalty:3009',
    promoServiceUrl: 'http://promo:3010',
    referralServiceUrl: 'http://referral:3011',
    crmServiceUrl: 'http://crm:3012',
    recommendationServiceUrl: 'http://reco:3013',
    forecastServiceUrl: 'http://forecast:3014',
    internalServiceKey: KEY,
    ...over,
  } as unknown as OrderConfigService;
}

function res(init: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throwJson?: boolean;
}): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => {
      if (init.throwJson) throw new Error('bad json');
      return init.body ?? {};
    },
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const order = (): OrderRecord =>
  ({
    id: randomUUID(),
    customerId: randomUUID(),
    depotId: randomUUID(),
    total: 57000.4,
    items: [
      { productId: randomUUID(), productName: 'Galon 19L', sku: 'G19', unit: 'Galon', quantity: 2 },
    ],
  }) as unknown as OrderRecord;

describe('InventoryHttpAdapter', () => {
  const items = [{ productId: randomUUID(), quantity: 2 }] as never;

  it('consume: skips when no internal key (fail open)', async () => {
    const a = new InventoryHttpAdapter(makeConfig({ internalServiceKey: '' }));
    await a.consume('d1', 'o1', items, '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consume: skips empty items', async () => {
    const a = new InventoryHttpAdapter(makeConfig());
    await a.consume('d1', 'o1', [] as never, '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consume: posts to depot inventory/consume on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    const a = new InventoryHttpAdapter(makeConfig());
    await a.consume('d1', 'o1', items, '');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://depot:3007/api/v1/depots/d1/inventory/consume',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('consume: fails open on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.consume('d1', 'o1', items, '')).resolves.toBeUndefined();
  });

  it('reserve: throws InsufficientStockError on 422', async () => {
    fetchMock.mockResolvedValue(
      res({ ok: false, status: HTTP_STATUS.UNPROCESSABLE, body: { message: 'Stok habis' } }),
    );
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', items, '')).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('reserve: happy path + fails open on other non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', items, '')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    await expect(a.reserve('d1', 'o1', items, '')).resolves.toBeUndefined();
  });

  it('release: happy path + skips without key', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new InventoryHttpAdapter(makeConfig()).release('d1', 'o1', items, '');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new InventoryHttpAdapter(makeConfig({ internalServiceKey: '' })).release(
      'd1',
      'o1',
      items,
      '',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DepotDirectoryHttpAdapter', () => {
  it('maps active depots on happy path', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: {
          items: [
            {
              id: 'd1',
              lat: 1,
              lng: 2,
              serviceRadiusKm: 5,
              deliveryFee: 3000,
              minOrderAmount: 10000,
            },
            { id: 'd2', lat: 3, lng: 4, serviceRadiusKm: 8, deliveryFee: 4000 },
          ],
        },
      }),
    );
    const out = await new DepotDirectoryHttpAdapter(makeConfig()).listActiveDepots();
    expect(out).toHaveLength(2);
    expect(out![1].minOrderAmount).toBeNull();
  });

  it('returns null on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await new DepotDirectoryHttpAdapter(makeConfig()).listActiveDepots()).toBeNull();
  });

  it('reads the depot owner over the internal-key route', async () => {
    fetchMock.mockResolvedValue(res({ body: { ownerId: 'owner-9', ownershipType: 'WARALABA' } }));
    const out = await new DepotDirectoryHttpAdapter(makeConfig()).findOwner('d1');
    expect(out).toEqual({ ownerId: 'owner-9', ownershipType: 'WARALABA' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot:3007/api/v1/depots/internal/d1/owner');
    expect(init.headers['x-internal-key']).toBe(KEY);
  });

  it('reports an ownerless franchise depot rather than flattening it to null', async () => {
    fetchMock.mockResolvedValue(res({ body: { ownerId: null, ownershipType: 'WARALABA' } }));
    expect(await new DepotDirectoryHttpAdapter(makeConfig()).findOwner('d1')).toEqual({
      ownerId: null,
      ownershipType: 'WARALABA',
    });
  });

  it('returns null for a non-2xx and a missing internal key', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 404 }));
    expect(await new DepotDirectoryHttpAdapter(makeConfig()).findOwner('d1')).toBeNull();

    fetchMock.mockClear();
    expect(
      await new DepotDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' })).findOwner('d1'),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults a body without an ownership type to a company depot', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    expect(await new DepotDirectoryHttpAdapter(makeConfig()).findOwner('d1')).toEqual({
      ownerId: null,
      ownershipType: 'HKP',
    });
  });
});

describe('FranchiseRevenueHttpAdapter', () => {
  const event = {
    orderId: 'o1',
    orderNumber: 'HM-1',
    franchiseOwnerId: 'owner-9',
    depotId: 'd1',
    amountIdr: 240000,
    completedAt: '2026-07-28T00:00:00.000Z',
  };

  it('posts the completed order with the internal key', async () => {
    fetchMock.mockResolvedValue(res({ body: { recorded: true } }));
    await new FranchiseRevenueHttpAdapter(
      makeConfig({ payoutServiceUrl: 'http://payout:3016' }),
    ).orderCompleted(event);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://payout:3016/api/v1/payout/revenue/internal');
    expect(init.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(init.body)).toMatchObject({
      orderId: 'o1',
      amountIdr: 240000,
      franchiseOwnerId: 'owner-9',
    });
  });

  it('skips the push when payout integration is not configured', async () => {
    await new FranchiseRevenueHttpAdapter(makeConfig({ payoutServiceUrl: '' })).orderCompleted(
      event,
    );
    await new FranchiseRevenueHttpAdapter(
      makeConfig({ payoutServiceUrl: 'http://payout:3016', internalServiceKey: '' }),
    ).orderCompleted(event);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a payout failure — completion must never depend on it', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    await expect(
      new FranchiseRevenueHttpAdapter(
        makeConfig({ payoutServiceUrl: 'http://payout:3016' }),
      ).orderCompleted(event),
    ).resolves.toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      new FranchiseRevenueHttpAdapter(
        makeConfig({ payoutServiceUrl: 'http://payout:3016' }),
      ).orderCompleted(event),
    ).resolves.toBeUndefined();
  });
});

describe('DepotPricingHttpAdapter', () => {
  it('returns empty map for no product ids', async () => {
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', []);
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds price map from rows', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: [
          { productId: 'p1', sellPrice: 21000 },
          { productId: 'p2', adjustType: 'PERCENT', value: 10 },
        ],
      }),
    );
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', ['p1', 'p2']);
    expect(out.get('p1')).toEqual({ sellPrice: 21000 });
    expect(out.get('p2')).toEqual({ adjustType: 'PERCENT', value: 10 });
  });

  it('returns empty map (fail open) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', ['p1']);
    expect(out.size).toBe(0);
  });
});

describe('ForecastCoordinationHttpAdapter', () => {
  it('skips without key', async () => {
    await new ForecastCoordinationHttpAdapter(
      makeConfig({ internalServiceKey: '' }),
    ).ingestCompletedOrder(order());
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('posts on happy path + fails open on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    await new ForecastCoordinationHttpAdapter(makeConfig()).ingestCompletedOrder(order());
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    await expect(
      new ForecastCoordinationHttpAdapter(makeConfig()).ingestCompletedOrder(order()),
    ).resolves.toBeUndefined();
  });
});

describe('RecommendationCoordinationHttpAdapter', () => {
  it('skips without key + posts on happy path', async () => {
    await new RecommendationCoordinationHttpAdapter(
      makeConfig({ internalServiceKey: '' }),
    ).recordCompleted(order());
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new RecommendationCoordinationHttpAdapter(makeConfig()).recordCompleted(order());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('LoyaltyCoordinationHttpAdapter', () => {
  it('skips without key + awards on happy path', async () => {
    await new LoyaltyCoordinationHttpAdapter(makeConfig({ internalServiceKey: '' })).awardPoints(
      'c1',
      'o1',
      50000,
      'd1',
      '',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LoyaltyCoordinationHttpAdapter(makeConfig()).awardPoints('c1', 'o1', 50000, 'd1', '');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the points loyalty actually awarded, and null when the body carries none', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { pointsEarned: 42 } }));
    await expect(
      new LoyaltyCoordinationHttpAdapter(makeConfig()).awardPoints('c1', 'o1', 50000, 'd1', ''),
    ).resolves.toBe(42);

    // No count in the body (or an unreadable one) is still a successful award — report
    // unknown rather than a number this service invented from the subtotal.
    fetchMock.mockResolvedValue(res({ ok: true }));
    await expect(
      new LoyaltyCoordinationHttpAdapter(makeConfig()).awardPoints('c1', 'o1', 50000, 'd1', ''),
    ).resolves.toBeNull();
    fetchMock.mockResolvedValue(res({ ok: true, throwJson: true }));
    await expect(
      new LoyaltyCoordinationHttpAdapter(makeConfig()).awardPoints('c1', 'o1', 50000, 'd1', ''),
    ).resolves.toBeNull();
  });

  it('forwards depotId in the POST body', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LoyaltyCoordinationHttpAdapter(makeConfig()).awardPoints('c1', 'o1', 50000, 'd1', '');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      customerId: 'c1',
      orderId: 'o1',
      subtotal: 50000,
      depotId: 'd1',
    });
  });
});

describe('MembershipHttpAdapter', () => {
  it('returns 0 without authorization', async () => {
    expect(await new MembershipHttpAdapter(makeConfig()).getDiscountRate('')).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns a valid discount rate', async () => {
    fetchMock.mockResolvedValue(res({ body: { discountRate: 0.1 } }));
    expect(await new MembershipHttpAdapter(makeConfig()).getDiscountRate('Bearer x')).toBe(0.1);
  });
  it('clamps out-of-range/invalid rate to 0', async () => {
    fetchMock.mockResolvedValue(res({ body: { discountRate: 2 } }));
    expect(await new MembershipHttpAdapter(makeConfig()).getDiscountRate('Bearer x')).toBe(0);
  });
  it('returns 0 (fail open) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await new MembershipHttpAdapter(makeConfig()).getDiscountRate('Bearer x')).toBe(0);
  });
  it('scopes the lookup to the fulfilling depot when one is given', async () => {
    fetchMock.mockResolvedValue(res({ body: { discountRate: 0.03 } }));
    await new MembershipHttpAdapter(makeConfig()).getDiscountRate('Bearer x', 'depot 1');
    expect(fetchMock.mock.calls[0][0]).toContain('/loyalty/me?depotId=depot%201');
  });
  it('omits the scope entirely without a depot', async () => {
    fetchMock.mockResolvedValue(res({ body: { discountRate: 0.03 } }));
    await new MembershipHttpAdapter(makeConfig()).getDiscountRate('Bearer x');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/loyalty\/me$/);
  });
});

describe('NotificationHttpAdapter', () => {
  it('skips without key + notifies on happy path', async () => {
    await new NotificationHttpAdapter(makeConfig({ internalServiceKey: '' })).notify(
      'e',
      'p',
      {},
      'c',
      '',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new NotificationHttpAdapter(makeConfig()).notify('e', 'p', {}, 'c', '');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ProductCatalogHttpAdapter', () => {
  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 404 }));
    expect(await new ProductCatalogHttpAdapter(makeConfig()).getProduct('p1')).toBeNull();
  });
  it('maps product on happy path', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: {
          id: 'p1',
          name: 'Galon',
          sku: 'G19',
          unit: 'Galon',
          basePrice: 20000,
          active: true,
        },
      }),
    );
    const p = await new ProductCatalogHttpAdapter(makeConfig()).getProduct('p1');
    expect(p).toMatchObject({ id: 'p1', basePrice: 20000 });
  });
  it('throws (not fail-open) on non-404 error', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(new ProductCatalogHttpAdapter(makeConfig()).getProduct('p1')).rejects.toThrow();
  });
});

describe('PromoHttpAdapter', () => {
  it('quote: returns discount on happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { discount: 5000 } }));
    const out = await new PromoHttpAdapter(makeConfig()).quote(
      'HEMAT',
      'c1',
      50000,
      3000,
      'Bearer x',
    );
    expect(out).toEqual({ discount: 5000, discountType: undefined });
  });
  it('quote: forwards discountType so checkout can pick the right ceiling (M5-18)', async () => {
    fetchMock.mockResolvedValue(res({ body: { discount: 3000, discountType: 'FREE_SHIPPING' } }));
    const out = await new PromoHttpAdapter(makeConfig()).quote(
      'ONGKIR',
      'c1',
      50000,
      3000,
      'Bearer x',
    );
    expect(out).toEqual({ discount: 3000, discountType: 'FREE_SHIPPING' });
  });
  it('quote: rejects on non-2xx with server message', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 400, body: { message: 'Kadaluarsa' } }));
    await expect(
      new PromoHttpAdapter(makeConfig()).quote('X', 'c1', 1, 0, 'Bearer x'),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
  });
  it('quote: rejects when the voucher service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new PromoHttpAdapter(makeConfig()).quote('X', 'c1', 1, 0, 'Bearer x'),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
  });
  it('redeem: skips without key + posts on happy path', async () => {
    await new PromoHttpAdapter(makeConfig({ internalServiceKey: '' })).redeem(
      'X',
      'c',
      'o',
      1,
      0,
      '',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new PromoHttpAdapter(makeConfig()).redeem('X', 'c', 'o', 1, 0, '');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ReferralCoordinationHttpAdapter', () => {
  it('skips without key + qualifies on happy path', async () => {
    await new ReferralCoordinationHttpAdapter(makeConfig({ internalServiceKey: '' })).qualify(
      'c1',
      'o1',
      '',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new ReferralCoordinationHttpAdapter(makeConfig()).qualify('c1', 'o1', '');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
