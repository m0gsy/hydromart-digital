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
import { PaymentCashHttpAdapter } from '../../src/infrastructure/http/payment-cash.http.adapter';
import { DeliverySlaHttpAdapter } from '../../src/infrastructure/http/delivery-sla.http.adapter';
import { DepotCostsHttpAdapter } from '../../src/infrastructure/http/depot-costs.http.adapter';
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

  // Depot SOP §3: the phone numbers come off an internal-key route, never the public
  // projection — they belong to depot staff and must not be scrapeable anonymously.
  it('reads depot contacts over the internal-key route', async () => {
    fetchMock.mockResolvedValue(
      res({ body: { depots: [{ id: 'd1', name: 'Depot Cikini', contactPhone: '0811' }] } }),
    );
    const out = await new DepotDirectoryHttpAdapter(makeConfig()).listContacts();
    expect(out).toEqual([{ id: 'd1', name: 'Depot Cikini', contactPhone: '0811' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot:3007/api/v1/depots/internal/contacts');
    expect(init.headers['x-internal-key']).toBe(KEY);
  });

  it('returns null for contacts on a non-2xx, a bad body, or a missing internal key', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    expect(await new DepotDirectoryHttpAdapter(makeConfig()).listContacts()).toBeNull();

    fetchMock.mockResolvedValueOnce(res({ body: {} }));
    expect(await new DepotDirectoryHttpAdapter(makeConfig()).listContacts()).toBeNull();

    fetchMock.mockClear();
    expect(
      await new DepotDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' })).listContacts(),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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

  // S2. `gallonsReturned`/`gallonsDamaged` were hardcoded null in the daily report; the
  // slip that answers them is written in depot-service.
  it('reads gallons returned over a window with the internal key', async () => {
    fetchMock.mockResolvedValue(res({ body: { gallons: 14, damaged: 3 } }));
    const from = new Date('2026-07-14T17:00:00.000Z');
    const to = new Date('2026-07-15T17:00:00.000Z');
    const out = await new DepotDirectoryHttpAdapter(makeConfig()).gallonReturns('d1', from, to);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://depot:3007/api/v1/gallon-outstanding/internal/returns-range?depotId=d1&from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe(KEY);
    expect(out).toEqual({ gallons: 14, damaged: 3 });
  });

  it('reads a partial returns body as zeroes, not as an outage', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    expect(
      await new DepotDirectoryHttpAdapter(makeConfig()).gallonReturns('d1', new Date(), new Date()),
    ).toEqual({ gallons: 0, damaged: 0 });
  });

  // Null, not zero: "no empties came back today" is a real operational fact.
  it.each([
    ['there is no internal key', { internalServiceKey: '' }, false],
    ['depot-service answers non-2xx', {}, true],
  ])('returns null when %s', async (_label, over, callsFetch) => {
    if (callsFetch) fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    const out = await new DepotDirectoryHttpAdapter(makeConfig(over)).gallonReturns(
      'd1',
      new Date(),
      new Date(),
    );
    expect(out).toBeNull();
    if (!callsFetch) expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when depot-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(
      await new DepotDirectoryHttpAdapter(makeConfig()).gallonReturns('d1', new Date(), new Date()),
    ).toBeNull();
  });
});

describe('FranchiseRevenueHttpAdapter', () => {
  const event = {
    orderId: 'o1',
    orderNumber: 'HM-1',
    franchiseOwnerId: 'owner-9',
    depotId: 'd1',
    amountIdr: 240000,
    // Goods before discount — the commission base, separate from the credited total.
    commissionBaseIdr: 200000,
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
      commissionBaseIdr: 200000,
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
  const send = (phone: string) =>
    new NotificationHttpAdapter(makeConfig()).notify('e', phone, {}, 'c', '');
  const sentPhone = () => JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body).phone;

  it('skips without key + notifies on happy path', async () => {
    await new NotificationHttpAdapter(makeConfig({ internalServiceKey: '' })).notify(
      'e',
      '081234567890',
      {},
      'c',
      '',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(res({ ok: true }));
    await send('081234567890');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /*
   * crm's SendNotificationDto only accepts digits (optionally +-prefixed) and this adapter
   * is fail-open — a 400 is logged and swallowed. So a human-typed number anywhere upstream
   * (a depot's contact number, the ops alert number) would produce a notification that never
   * arrives and never complains. Normalised once here, where all six callers route through.
   */
  it('strips the separators a human types, keeping a leading +', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await send('0812-3456-7890');
    expect(sentPhone()).toBe('081234567890');
    await send('+62 812 3456 7890');
    expect(sentPhone()).toBe('+6281234567890');
    await send(' (0812) 3456.7890 ');
    expect(sentPhone()).toBe('081234567890');
  });

  it('names a number that is unusable even after stripping, instead of a silent 400', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    for (const bad of ['', 'telp depot', '0812', '-']) {
      fetchMock.mockClear();
      await send(bad);
      expect(fetchMock).not.toHaveBeenCalled();
    }
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

// S2. The daily report's two cash figures. Unlike the reversal above this fails SOFT: it
// only reports on money already moved, and a report that refuses to render because one
// service blinked is worse than one that says "—".
describe('PaymentCashHttpAdapter', () => {
  const cash = (over: Partial<Record<string, unknown>> = {}) =>
    new PaymentCashHttpAdapter(makeConfig({ paymentServiceUrl: 'http://payment:3005', ...over }));

  it('POSTs the order ids with the internal key and returns the split', async () => {
    fetchMock.mockResolvedValue(
      res({ ok: true, body: { total: 40000, count: 1, byOrder: [{ orderId: 'o1', amountIdr: 40000 }] } }),
    );
    const rows = await cash().cashByOrder(['o1', 'o2']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://payment:3005/api/v1/payments/internal/cash-collected');
    const sent = init as { method: string; headers: Record<string, string>; body: string };
    expect(sent.method).toBe('POST');
    expect(sent.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(sent.body)).toEqual({ orderIds: ['o1', 'o2'] });
    expect(rows).toEqual([{ orderId: 'o1', amountIdr: 40000 }]);
  });

  it('short-circuits an empty id set without a round-trip', async () => {
    expect(await cash().cashByOrder([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a body with no byOrder as an empty split, not as an outage', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { total: 0, count: 0 } }));
    expect(await cash().cashByOrder(['o1'])).toEqual([]);
  });

  it('GETs the depot window and rounds the total', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { total: 25000.4, count: 2 } }));
    const from = new Date('2026-07-14T17:00:00.000Z');
    const to = new Date('2026-07-15T17:00:00.000Z');
    const total = await cash().depotCash('depot-1', from, to);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://payment:3005/api/v1/payments/internal/depot-cash?depotId=depot-1&from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    expect(total).toBe(25000);
  });

  it('reads a body with no total as zero', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: {} }));
    expect(await cash().depotCash('depot-1', new Date(), new Date())).toBe(0);
  });

  it.each([
    ['payment-service is unconfigured', { paymentServiceUrl: '' }],
    ['there is no internal key', { internalServiceKey: '' }],
  ])('returns null rather than 0 when %s', async (_label, over) => {
    expect(await cash(over).cashByOrder(['o1'])).toBeNull();
    expect(await cash(over).depotCash('depot-1', new Date(), new Date())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Null, not 0. "payment-service is down" and "the courier collected nothing" are
  // different answers, and one of them means somebody is holding cash nobody counted.
  it('returns null on a non-2xx and on an unreachable service', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    expect(await cash().cashByOrder(['o1'])).toBeNull();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await cash().depotCash('depot-1', new Date(), new Date())).toBeNull();
  });
});

// S2. `slaPct` on the monthly review. order-service has no delivery timings — an order's
// status says it was delivered, never whether it was late — so this asks the service that
// measures it, and fails soft rather than inferring a percentage.
describe('DeliverySlaHttpAdapter', () => {
  const sla = (over: Partial<Record<string, unknown>> = {}) =>
    new DeliverySlaHttpAdapter(makeConfig({ deliveryServiceUrl: 'http://delivery:3006', ...over }));

  it('asks for one depot over the window with the internal key', async () => {
    fetchMock.mockResolvedValue(res({ body: { slaRate: 0.876, totalDelivered: 40 } }));
    const from = new Date('2026-06-30T17:00:00.000Z');
    const to = new Date('2026-07-31T17:00:00.000Z');
    expect(await sla().onTimeRate('d1', from, to)).toBe(0.876);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://delivery:3006/api/v1/reports/internal/sla?depotIds=d1&from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe(KEY);
  });

  // slaRate is 0 when nothing was delivered. That is a true statement about a quiet month
  // and a false one about a depot's punctuality, so it must not reach the screen as 0%.
  it('returns null for a window with no deliveries', async () => {
    fetchMock.mockResolvedValue(res({ body: { slaRate: 0, totalDelivered: 0 } }));
    expect(await sla().onTimeRate('d1', new Date(), new Date())).toBeNull();
  });

  it('returns null when the body carries no rate', async () => {
    fetchMock.mockResolvedValue(res({ body: { totalDelivered: 12 } }));
    expect(await sla().onTimeRate('d1', new Date(), new Date())).toBeNull();
  });

  it.each([
    ['delivery-service is unconfigured', { deliveryServiceUrl: '' }],
    ['there is no internal key', { internalServiceKey: '' }],
  ])('returns null without a round-trip when %s', async (_label, over) => {
    expect(await sla(over).onTimeRate('d1', new Date(), new Date())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on a non-2xx and when delivery-service is unreachable', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await sla().onTimeRate('d1', new Date(), new Date())).toBeNull();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await sla().onTimeRate('d1', new Date(), new Date())).toBeNull();
  });
});

// S2. The cost side of net profit: goods + till from depot-service, payroll from hr-service.
// One adapter for two services because it is one question — splitting it would let a caller
// fetch half a P&L and believe it had one.
describe('DepotCostsHttpAdapter', () => {
  const costs = (over: Partial<Record<string, unknown>> = {}) =>
    new DepotCostsHttpAdapter(makeConfig({ hrServiceUrl: 'http://hr:3018', ...over }));
  const FROM = new Date('2026-06-30T17:00:00.000Z');
  const TO = new Date('2026-07-31T17:00:00.000Z');

  it('reads goods and till from depot-service over the internal key', async () => {
    fetchMock.mockResolvedValue(res({ body: { cogsIdr: 4_000_000, opexIdr: 1_900_000 } }));
    const out = await costs().costs('d1', FROM, TO);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://depot:3007/api/v1/cashbook/internal/depot-costs?depotId=d1&from=${FROM.toISOString()}&to=${TO.toISOString()}`,
    );
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe(KEY);
    expect(out).toEqual({ cogsIdr: 4_000_000, opexIdr: 1_900_000 });
  });

  it('reads payroll for the REPORTED month, not for today', async () => {
    fetchMock.mockResolvedValue(res({ body: { payrollMtdNet: 3_000_000 } }));
    expect(await costs().payroll('d1', '2026-07')).toBe(3_000_000);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://hr:3018/api/v1/hr-reports/internal/depot-summary?depotId=d1&periodMonth=2026-07',
    );
  });

  it('reads a partial body as zeroes once the service did answer', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    expect(await costs().costs('d1', FROM, TO)).toEqual({ cogsIdr: 0, opexIdr: 0 });
    expect(await costs().payroll('d1', '2026-07')).toBe(0);
  });

  // Null per source, so the SERVICE can refuse to publish a partial profit. This layer only
  // says honestly which half it could not get.
  it.each([
    ['depot-service is unconfigured', { depotServiceUrl: '' }, 'costs'],
    ['hr-service is unconfigured', { hrServiceUrl: '' }, 'payroll'],
    ['there is no internal key', { internalServiceKey: '' }, 'costs'],
  ])('returns null without a round-trip when %s', async (_label, over, which) => {
    const a = costs(over);
    const out = which === 'costs' ? await a.costs('d1', FROM, TO) : await a.payroll('d1', '2026-07');
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on a non-2xx and when the service is unreachable', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await costs().costs('d1', FROM, TO)).toBeNull();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await costs().payroll('d1', '2026-07')).toBeNull();
  });

  it('reads the governance figures over the internal key', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: {
          approvalsReviewed: 3,
          opnameVarianceIdr: -40_000,
          settlementVarianceIdr: -20_000,
          daysClosed: 30,
        },
      }),
    );
    const out = await costs().governance('d1', FROM, TO);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://depot:3007/api/v1/reports/internal/governance?depotId=d1&from=${FROM.toISOString()}&to=${TO.toISOString()}`,
    );
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe(KEY);
    expect(out).toEqual({
      approvalsReviewed: 3,
      opnameVarianceIdr: -40_000,
      settlementVarianceIdr: -20_000,
      daysClosed: 30,
    });
  });

  it('reads a governance body missing every field as zeroes, not as null', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    await expect(costs().governance('d1', FROM, TO)).resolves.toEqual({
      approvalsReviewed: 0,
      opnameVarianceIdr: 0,
      settlementVarianceIdr: 0,
      daysClosed: 0,
    });
  });

  it('returns null governance without a round-trip when depot-service is unconfigured', async () => {
    await expect(costs({ depotServiceUrl: '' }).governance('d1', FROM, TO)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
