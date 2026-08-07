import { randomUUID } from 'node:crypto';

import { HTTP_STATUS } from '@hydromart/platform';

import { OrderConfigService } from '../../src/config/order-config.service';
import {
  InsufficientStockError,
  StockCheckUnavailableError,
  PaymentReversalFailedError,
  VoucherRejectedError,
} from '../../src/domain/errors';
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
import { CashierShiftHttpAdapter } from '../../src/infrastructure/http/cashier-shift.http.adapter';
import { PaymentReversalHttpAdapter } from '../../src/infrastructure/http/payment-reversal.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';

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

  // B-6b: reserve used to fail OPEN on everything except a 422 — the previous version of
  // this test asserted exactly that ("fails open on other non-2xx"), which is how the
  // behaviour survived review. A depot-service outage therefore did not stop sales, it
  // silently turned every order in that window into an unreserved one. Reserve is the step
  // that makes a sale safe to promise, so it now fails CLOSED on anything that is not a
  // verdict, matching how the SEC-1 amount guard already treats money.
  it('reserve: succeeds when the depot confirms', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', items, '')).resolves.toBeUndefined();
  });

  it('reserve: fails closed on a depot-service 5xx', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', items, '')).rejects.toBeInstanceOf(
      StockCheckUnavailableError,
    );
  });

  it('reserve: fails closed when depot-service is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', items, '')).rejects.toBeInstanceOf(
      StockCheckUnavailableError,
    );
  });

  it('reserve: fails closed when the call times out', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', items, '')).rejects.toBeInstanceOf(
      StockCheckUnavailableError,
    );
  });

  it('reserve: fails closed when the internal key is missing — that is a config fault, not a reason to oversell', async () => {
    const a = new InventoryHttpAdapter(makeConfig({ internalServiceKey: '' }));
    await expect(a.reserve('d1', 'o1', items, '')).rejects.toBeInstanceOf(
      StockCheckUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reserve: an empty cart is the one genuinely safe skip', async () => {
    const a = new InventoryHttpAdapter(makeConfig());
    await expect(a.reserve('d1', 'o1', [] as never, '')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restock: puts a voided sale back, skipping without key or items', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new InventoryHttpAdapter(makeConfig()).restock('d1', 'o1', items, '');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://depot:3007/api/v1/depots/d1/inventory/restock',
      expect.objectContaining({ method: 'POST' }),
    );
    await new InventoryHttpAdapter(makeConfig()).restock('d1', 'o1', [] as never, '');
    await new InventoryHttpAdapter(makeConfig({ internalServiceKey: '' })).restock(
      'd1',
      'o1',
      items,
      '',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Fail OPEN like consume: the buyer has the goods and the money back by now, and a
  // depot-service blip must not leave the order un-voided. Opname reconciles a miss.
  it('restock: fails open on non-2xx and on an unreachable depot-service', async () => {
    const a = new InventoryHttpAdapter(makeConfig());
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 503 }));
    await expect(a.restock('d1', 'o1', items, '')).resolves.toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(a.restock('d1', 'o1', items, '')).resolves.toBeUndefined();
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

  it('posts the void so the owner stops being paid for a reversed order', async () => {
    fetchMock.mockResolvedValue(res({ body: { voided: true } }));
    await new FranchiseRevenueHttpAdapter(
      makeConfig({ payoutServiceUrl: 'http://payout:3016' }),
    ).orderVoided('o1', 'refund');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://payout:3016/api/v1/payout/revenue/internal/void');
    expect(init.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual({ orderId: 'o1', reason: 'refund' });
  });

  it('skips the void when payout integration is not configured', async () => {
    await new FranchiseRevenueHttpAdapter(makeConfig({ payoutServiceUrl: '' })).orderVoided(
      'o1',
      'refund',
    );
    await new FranchiseRevenueHttpAdapter(
      makeConfig({ payoutServiceUrl: 'http://payout:3016', internalServiceKey: '' }),
    ).orderVoided('o1', 'refund');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a payout failure on the void — the refund must still go through', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    await expect(
      new FranchiseRevenueHttpAdapter(
        makeConfig({ payoutServiceUrl: 'http://payout:3016' }),
      ).orderVoided('o1', 'refund'),
    ).resolves.toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      new FranchiseRevenueHttpAdapter(
        makeConfig({ payoutServiceUrl: 'http://payout:3016' }),
      ).orderVoided('o1', 'refund'),
    ).resolves.toBeUndefined();
  });
});

describe('DepotPricingHttpAdapter', () => {
  it('returns empty map for no product ids', async () => {
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', []);
    expect(out.prices.size).toBe(0);
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
    expect(out.prices.get('p1')).toEqual({ sellPrice: 21000 });
    expect(out.prices.get('p2')).toEqual({ adjustType: 'PERCENT', value: 10 });
  });

  it('returns empty map (fail open) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', ['p1']);
    expect(out.prices.size).toBe(0);
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

  // Named by order, never by an amount: loyalty-service owns the per-depot earn rate, so a
  // figure computed here would claw back the wrong number at every depot that overrode it.
  it('reverses by order over the internal route', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LoyaltyCoordinationHttpAdapter(makeConfig()).reversePoints('c1', 'o1', 'Batal');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://loyalty:3009/api/v1/loyalty/internal/reverse-earn');
    const sent = init as { headers: Record<string, string>; body: string };
    expect(sent.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(sent.body)).toEqual({ customerId: 'c1', orderId: 'o1', reason: 'Batal' });
  });

  // Fail OPEN, unlike the refund: the buyer already has their money back by the time this
  // runs, and blocking the void on a loyalty outage strands the sale mid-reversal.
  it('never throws — no key, non-2xx, or unreachable all resolve', async () => {
    const adapter = new LoyaltyCoordinationHttpAdapter(makeConfig({ internalServiceKey: '' }));
    await expect(adapter.reversePoints('c1', 'o1', 'x')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    const live = new LoyaltyCoordinationHttpAdapter(makeConfig());
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(live.reversePoints('c1', 'o1', 'x')).resolves.toBeUndefined();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(live.reversePoints('c1', 'o1', 'x')).resolves.toBeUndefined();
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
  // B-6: a blank internal key used to make redeem a no-op, so every voucher was honoured
  // for free until someone noticed. A config fault is not permission to give away money.
  it('redeem: refuses without an internal key, posts on the happy path', async () => {
    await expect(
      new PromoHttpAdapter(makeConfig({ internalServiceKey: '' })).redeem('X', 'c', 'o', 1, 0, ''),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(res({ ok: true }));
    await new PromoHttpAdapter(makeConfig()).redeem('X', 'c', 'o', 1, 0, '');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Every branch here decides whether cash may be taken, so every branch has to say NO
// unless depot-service positively confirms the caller is on the counter.
describe('CashierShiftHttpAdapter', () => {
  const shift = (over: Partial<Record<string, unknown>> = {}) =>
    new CashierShiftHttpAdapter(makeConfig(over));

  it('confirms an open shift and carries the caller token to that depot', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { id: 'shift-1' } }));
    expect(await shift().hasOpenShift('depot-1', 'Bearer t')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot:3007/api/v1/cashier-shifts/current?depotId=depot-1');
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe('Bearer t');
  });

  // depot-service answering `null` is not a failure: the caller simply is not on the counter.
  it('reads a null body as "no shift"', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: null }));
    expect(await shift().hasOpenShift('depot-1', 'Bearer t')).toBe(false);
  });

  it('refuses without a token, and never asks', async () => {
    expect(await shift().hasOpenShift('depot-1', '')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when depot-service is unconfigured', async () => {
    expect(await shift({ depotServiceUrl: '' }).hasOpenShift('depot-1', 'Bearer t')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED on a non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await shift().hasOpenShift('depot-1', 'Bearer t')).toBe(false);
  });

  it('fails CLOSED when depot-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await shift().hasOpenShift('depot-1', 'Bearer t')).toBe(false);
  });

  it('fails CLOSED on an unparseable body', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, throwJson: true }));
    expect(await shift().hasOpenShift('depot-1', 'Bearer t')).toBe(false);
  });
});

// The only outbound call here that must throw rather than log-and-continue: this IS the
// money. A silent failure would mark a sale reversed while payment-service still holds it.
describe('PaymentReversalHttpAdapter', () => {
  const reversal = (over: Partial<Record<string, unknown>> = {}) =>
    new PaymentReversalHttpAdapter(makeConfig({ paymentServiceUrl: 'http://payment:3005', ...over }));

  it('posts the order and reason with the internal key', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await reversal().voidForOrder('order-1', 'Salah ukuran');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://payment:3005/api/v1/payments/internal/void-for-order');
    const sent = init as { headers: Record<string, string>; body: string };
    expect(sent.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(sent.body)).toEqual({ orderId: 'order-1', reason: 'Salah ukuran' });
  });

  it.each([
    ['payment-service is unconfigured', { paymentServiceUrl: '' }],
    ['there is no internal key', { internalServiceKey: '' }],
  ])('throws rather than skip when %s', async (_label, over) => {
    await expect(reversal(over).voidForOrder('order-1', 'x')).rejects.toBeInstanceOf(
      PaymentReversalFailedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(reversal().voidForOrder('order-1', 'x')).rejects.toBeInstanceOf(
      PaymentReversalFailedError,
    );
  });

  it('throws when payment-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(reversal().voidForOrder('order-1', 'x')).rejects.toBeInstanceOf(
      PaymentReversalFailedError,
    );
  });
});

// Both of these exist because a counter sale runs on the CASHIER's token: quoting or
// pricing by token there would answer about the cashier, not the buyer.
describe('counter-sale reads that name the buyer', () => {
  it('membership: reads the named customer over the internal key', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { discountRate: 0.05 } }));
    const rate = await new MembershipHttpAdapter(makeConfig()).getDiscountRateFor('cust-9', 'd1');
    expect(rate).toBe(0.05);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://loyalty:3009/api/v1/loyalty/accounts/cust-9?depotId=d1');
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe(KEY);
  });

  it('membership: falls back to the global ladder with no depot, and fails open at 0', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { discountRate: 0.03 } }));
    await new MembershipHttpAdapter(makeConfig()).getDiscountRateFor('cust-9');
    expect(fetchMock.mock.calls[0][0]).toBe('http://loyalty:3009/api/v1/loyalty/accounts/cust-9');

    // Fail OPEN: an always-on benefit must never block a sale.
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new MembershipHttpAdapter(makeConfig()).getDiscountRateFor('cust-9'),
    ).resolves.toBe(0);
    await expect(
      new MembershipHttpAdapter(makeConfig({ internalServiceKey: '' })).getDiscountRateFor('c'),
    ).resolves.toBe(0);
  });

  it('promo: quotes the named wallet over the internal route', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { discount: 5000, discountType: 'PERCENT' } }));
    const quote = await new PromoHttpAdapter(makeConfig()).quoteFor('HEMAT', 'cust-9', 40000, 0);
    expect(quote).toEqual({ discount: 5000, discountType: 'PERCENT' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://promo:3010/api/v1/vouchers/quote/internal');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      code: 'HEMAT',
      customerId: 'cust-9',
      subtotal: 40000,
      shippingFee: 0,
    });
  });

  // Fail CLOSED: a voucher the buyer handed over must be honoured or the sale must stop —
  // never silently dropped at full price with them watching.
  it('promo: rejects rather than charge full price when the quote cannot be made', async () => {
    await expect(
      new PromoHttpAdapter(makeConfig({ internalServiceKey: '' })).quoteFor('X', 'c', 1, 0),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(res({ ok: false, status: 422, body: { message: 'Minimum belum' } }));
    await expect(
      new PromoHttpAdapter(makeConfig()).quoteFor('X', 'c', 1, 0),
    ).rejects.toThrow('Minimum belum');

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new PromoHttpAdapter(makeConfig()).quoteFor('X', 'c', 1, 0),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
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

/*
 * §I: order-service telling customer-service where somebody just bought, so a
 * self-registered customer appears in that depot's directory.
 *
 * Fails OPEN on every path — the order is already placed and paid for, and a directory row
 * is not worth unwinding it over. `false` therefore means "not recorded", never an error.
 */
describe('CustomerDirectoryHttpAdapter', () => {
  const config = makeConfig({ customerServiceUrl: 'http://customer:3002' });
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function quiet(adapter: CustomerDirectoryHttpAdapter) {
    jest.spyOn(adapter['logger'], 'warn').mockImplementation(() => undefined);
    return adapter;
  }

  it('posts the claim over the internal key and reports what was written', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res({ body: { claimed: true } }));
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await expect(
      new CustomerDirectoryHttpAdapter(config).claimFavoriteDepot('c1', 'd1'),
    ).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://customer:3002/api/v1/customers/internal/favorite-depot');
    expect(init.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual({ customerId: 'c1', depotId: 'd1' });
  });

  it('reports false when the customer already had a favourite', async () => {
    (globalThis as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue(res({ body: { claimed: false } }));
    await expect(
      new CustomerDirectoryHttpAdapter(config).claimFavoriteDepot('c1', 'd1'),
    ).resolves.toBe(false);
  });

  it('calls nothing when there is no internal key', async () => {
    const fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    const adapter = new CustomerDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' }));
    await expect(adapter.claimFavoriteDepot('c1', 'd1')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open on a refusal, on an unreachable service, and on an unreadable body', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(res({ ok: false }));
    await expect(
      quiet(new CustomerDirectoryHttpAdapter(config)).claimFavoriteDepot('c1', 'd1'),
    ).resolves.toBe(false);

    (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      quiet(new CustomerDirectoryHttpAdapter(config)).claimFavoriteDepot('c1', 'd1'),
    ).resolves.toBe(false);

    (globalThis as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue(res({ throwJson: true }));
    await expect(
      quiet(new CustomerDirectoryHttpAdapter(config)).claimFavoriteDepot('c1', 'd1'),
    ).resolves.toBe(false);
  });

  // §I: the counter buyer. Resolution used to happen in the POS page's browser, so any
  // other client posting /orders/walk-in with a phone created nobody.
  describe('resolveByPhone', () => {
    it('posts the phone and hands back the account it resolved', async () => {
      const fetchMock = jest.fn().mockResolvedValue(res({ body: { customerId: 'c9' } }));
      (globalThis as { fetch: unknown }).fetch = fetchMock;

      await expect(
        new CustomerDirectoryHttpAdapter(config).resolveByPhone('0811', 'Budi', 'd1'),
      ).resolves.toBe('c9');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://customer:3002/api/v1/customers/internal/resolve-by-phone');
      expect(init.headers['x-internal-key']).toBe(KEY);
      expect(JSON.parse(init.body)).toEqual({ phone: '0811', fullName: 'Budi', depotId: 'd1' });
    });

    it('calls nothing when there is no internal key', async () => {
      const fetchMock = jest.fn();
      (globalThis as { fetch: unknown }).fetch = fetchMock;
      const adapter = new CustomerDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' }));

      await expect(adapter.resolveByPhone('0811', 'Budi', 'd1')).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Fails OPEN: the sale is booked anonymously rather than a cashier being stopped with
    // the buyer standing at the counter.
    it('answers null on a refusal, an outage, and an unreadable body', async () => {
      (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(res({ ok: false }));
      await expect(
        quiet(new CustomerDirectoryHttpAdapter(config)).resolveByPhone('0811', 'Budi', 'd1'),
      ).resolves.toBeNull();

      (globalThis as { fetch: unknown }).fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        quiet(new CustomerDirectoryHttpAdapter(config)).resolveByPhone('0811', 'Budi', 'd1'),
      ).resolves.toBeNull();

      (globalThis as { fetch: unknown }).fetch = jest
        .fn()
        .mockResolvedValue(res({ throwJson: true }));
      await expect(
        quiet(new CustomerDirectoryHttpAdapter(config)).resolveByPhone('0811', 'Budi', 'd1'),
      ).resolves.toBeNull();
    });
  });
});
