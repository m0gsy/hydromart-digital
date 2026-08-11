import { OrderConfigService } from '../../src/config/order-config.service';
import { StockCheckUnavailableError, VoucherRejectedError } from '../../src/domain/errors';
import type { OrderRecord } from '../../src/application/ports/order.repository';
import { LoyaltyCoordinationHttpAdapter } from '../../src/infrastructure/http/loyalty-coordination.http.adapter';
import { NotificationHttpAdapter } from '../../src/infrastructure/http/notification.http.adapter';
import { ReferralCoordinationHttpAdapter } from '../../src/infrastructure/http/referral-coordination.http.adapter';
import { RecommendationCoordinationHttpAdapter } from '../../src/infrastructure/http/recommendation-coordination.http.adapter';
import { ForecastCoordinationHttpAdapter } from '../../src/infrastructure/http/forecast-coordination.http.adapter';
import { PromoHttpAdapter } from '../../src/infrastructure/http/promo.http.adapter';
import { InventoryHttpAdapter } from '../../src/infrastructure/http/inventory.http.adapter';
import { DepotPricingHttpAdapter } from '../../src/infrastructure/http/depot-pricing.http.adapter';
import { DepotDirectoryHttpAdapter } from '../../src/infrastructure/http/depot-directory.http.adapter';
import { FranchiseRevenueHttpAdapter } from '../../src/infrastructure/http/franchise-revenue.http.adapter';
import { MembershipHttpAdapter } from '../../src/infrastructure/http/membership.http.adapter';
import { ProductCatalogHttpAdapter } from '../../src/infrastructure/http/product-catalog.http.adapter';
import { ResellerDiscountHttpAdapter } from '../../src/infrastructure/http/reseller-discount.http.adapter';
import { CashierShiftHttpAdapter } from '../../src/infrastructure/http/cashier-shift.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';
import { PaymentReversalHttpAdapter } from '../../src/infrastructure/http/payment-reversal.http.adapter';

// Covers the error branches the happy-path specs don't reach: the `if (!res.ok) throw`
// guards feeding each adapter's catch.
//
// The dividing line is whether the call is what makes the order legitimate. Fire-and-forget
// coordination (points, notifications, referrals, analytics) swallows a non-2xx and never
// blocks an order. The calls the order DEPENDS on reject it instead: promo.quote, product,
// inventory.reserve (B-6b) and promo.redeem (B-6).

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): OrderConfigService {
  return {
    depotServiceUrl: 'http://depot:3007',
    loyaltyServiceUrl: 'http://loyalty:3009',
    promoServiceUrl: 'http://promo:3010',
    referralServiceUrl: 'http://referral:3011',
    crmServiceUrl: 'http://crm:3012',
    recommendationServiceUrl: 'http://reco:3013',
    forecastServiceUrl: 'http://forecast:3014',
    customerServiceUrl: 'http://customer:3002',
    internalServiceKey: KEY,
    ...over,
  } as unknown as OrderConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => init.body ?? {},
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const order = (): OrderRecord =>
  ({
    id: 'o1',
    customerId: 'c1',
    depotId: 'd1',
    total: 57000.4,
    items: [{ productId: 'p1', productName: 'Galon 19L', sku: 'G19', unit: 'Galon', quantity: 2 }],
  }) as unknown as OrderRecord;

const line = [{ productId: 'p1', quantity: 2 }] as never;

describe('coordination adapters fail open on a non-2xx response', () => {
  it('loyalty.awardPoints swallows a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    // null = "no points to report", the only honest answer when the award never landed.
    await expect(
      new LoyaltyCoordinationHttpAdapter(makeConfig()).awardPoints('c1', 'o1', 50000, 'd1', ''),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('notification.notify swallows a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new NotificationHttpAdapter(makeConfig()).notify('e', '081234567890', {}, 'c', ''),
    ).resolves.toBeUndefined();
  });

  it('referral.qualify swallows a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new ReferralCoordinationHttpAdapter(makeConfig()).qualify('c1', 'o1', ''),
    ).resolves.toBeUndefined();
  });

  it('recommendation.recordCompleted swallows a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new RecommendationCoordinationHttpAdapter(makeConfig()).recordCompleted(order()),
    ).resolves.toBeUndefined();
  });

  it('forecast.ingestCompletedOrder swallows a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new ForecastCoordinationHttpAdapter(makeConfig()).ingestCompletedOrder(order()),
    ).resolves.toBeUndefined();
  });

  // B-6: this used to assert redeem SWALLOWS a 500, on the reasoning that the burn is
  // idempotent so a failure "only under-counts usage". It does more than that — the order
  // is created with the discount already applied, so a failed burn gives away money and
  // leaves the voucher live and reusable. The burn is what makes the discount legitimate.
  it('promo.redeem rejects the checkout when the burn fails', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new PromoHttpAdapter(makeConfig()).redeem('X', 'c', 'o', 1, 0, ''),
    ).rejects.toBeInstanceOf(VoucherRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('inventory.release swallows a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new InventoryHttpAdapter(makeConfig()).release('d1', 'o1', line, ''),
    ).resolves.toBeUndefined();
  });
});

// Every adapter arms a setTimeout that aborts its request. Nothing had ever let that timer
// fire, so the abort itself was never exercised: a hung dependency must still make the call
// settle (fail open for coordination, fail closed for the two the order depends on).
describe('an outbound call that hangs is aborted and still settles', () => {
  const cfg = (): OrderConfigService =>
    makeConfig({
      productServiceUrl: 'http://product:3003',
      payoutServiceUrl: 'http://payout:3016',
      paymentServiceUrl: 'http://payment:3005',
    });

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        }),
    );
  });
  afterEach(() => jest.useRealTimers());

  const revenue = { orderId: 'o1', depotId: 'd1', amountIdr: 240000 } as never;
  const cases: [string, () => Promise<unknown>][] = [
    [
      'depot-directory.listActiveDepots',
      () => new DepotDirectoryHttpAdapter(cfg()).listActiveDepots(),
    ],
    ['depot-directory.findOwner', () => new DepotDirectoryHttpAdapter(cfg()).findOwner('d1')],
    ['depot-pricing.getPrices', () => new DepotPricingHttpAdapter(cfg()).getPrices('d1', ['p1'])],
    [
      'forecast.ingestCompletedOrder',
      () => new ForecastCoordinationHttpAdapter(cfg()).ingestCompletedOrder(order()),
    ],
    [
      'franchise-revenue.orderCompleted',
      () => new FranchiseRevenueHttpAdapter(cfg()).orderCompleted(revenue),
    ],
    ['inventory.consume', () => new InventoryHttpAdapter(cfg()).consume('d1', 'o1', line, '')],
    ['inventory.reserve', () => new InventoryHttpAdapter(cfg()).reserve('d1', 'o1', line, '')],
    ['inventory.release', () => new InventoryHttpAdapter(cfg()).release('d1', 'o1', line, '')],
    [
      'loyalty.awardPoints',
      () => new LoyaltyCoordinationHttpAdapter(cfg()).awardPoints('c1', 'o1', 50000, 'd1', ''),
    ],
    [
      'membership.getDiscountRate',
      () => new MembershipHttpAdapter(cfg()).getDiscountRate('Bearer t'),
    ],
    [
      'notification.notify',
      () => new NotificationHttpAdapter(cfg()).notify('e', '081234567890', {}, 'c', ''),
    ],
    ['product-catalog.getProduct', () => new ProductCatalogHttpAdapter(cfg()).getProduct('p1')],
    ['promo.quote', () => new PromoHttpAdapter(cfg()).quote('X', 'c1', 1, 0, 'Bearer x')],
    ['promo.redeem', () => new PromoHttpAdapter(cfg()).redeem('X', 'c', 'o', 1, 0, '')],
    [
      'recommendation.recordCompleted',
      () => new RecommendationCoordinationHttpAdapter(cfg()).recordCompleted(order()),
    ],
    ['referral.qualify', () => new ReferralCoordinationHttpAdapter(cfg()).qualify('c1', 'o1', '')],
    ['reseller-discount.get', () => new ResellerDiscountHttpAdapter(cfg()).get('Bearer t')],
    [
      'franchise-revenue.orderVoided',
      () => new FranchiseRevenueHttpAdapter(cfg()).orderVoided('o1', 'refund'),
    ],
    ['inventory.restock', () => new InventoryHttpAdapter(cfg()).restock('d1', 'o1', line, '')],
    [
      'loyalty.reversePoints',
      () => new LoyaltyCoordinationHttpAdapter(cfg()).reversePoints('c1', 'o1', 'refund'),
    ],
    [
      'cashier-shift.hasOpenShift',
      () => new CashierShiftHttpAdapter(cfg()).hasOpenShift('d1', 'Bearer t'),
    ],
    [
      'customer-directory.claimFavoriteDepot',
      () => new CustomerDirectoryHttpAdapter(cfg()).claimFavoriteDepot('c1', 'd1'),
    ],
    [
      'customer-directory.resolveByPhone',
      () => new CustomerDirectoryHttpAdapter(cfg()).resolveByPhone('0811', 'Budi', 'd1'),
    ],
    [
      'payment-reversal.voidForOrder',
      () => new PaymentReversalHttpAdapter(cfg()).voidForOrder('o1', 'refund'),
    ],
    [
      'product-catalog.getProducts',
      () => new ProductCatalogHttpAdapter(cfg()).getProducts(['p1', 'p2']),
    ],
  ];

  it.each(cases)('%s', async (_name, run) => {
    // The handler has to be attached before the timer fires, or the rejection lands unhandled.
    const settled = run().then(
      () => 'settled',
      () => 'settled',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await settled).toBe('settled');
    expect(fetchMock).toHaveBeenCalled();
  });
});

// A dependency that answers with a body that is not JSON at all: the parse must not become the
// error the caller sees.
describe('unparseable response bodies', () => {
  const badJson = (status: number): Response =>
    ({
      ok: status < 400,
      status,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }) as unknown as Response;

  it('promo.quote still rejects with the generic voucher message', async () => {
    fetchMock.mockResolvedValue(badJson(400));
    await expect(
      new PromoHttpAdapter(makeConfig()).quote('X', 'c1', 1, 0, 'Bearer x'),
    ).rejects.toThrow(/could not be applied/);
  });

  it('promo.quote reads a 200 with no discount field as no discount', async () => {
    fetchMock.mockResolvedValue(badJson(200));
    await expect(
      new PromoHttpAdapter(makeConfig()).quote('X', 'c1', 1, 0, 'Bearer x'),
    ).resolves.toEqual({ discount: 0, discountType: undefined });
  });

  it('inventory.reserve reports a shortfall even when the 422 body is unreadable', async () => {
    fetchMock.mockResolvedValue(badJson(422));
    await expect(
      new InventoryHttpAdapter(makeConfig()).reserve('d1', 'o1', line, ''),
    ).rejects.toThrow();
  });

  it('depot-pricing keeps a row that carries only a tier price', async () => {
    fetchMock.mockResolvedValue(res({ body: [{ productId: 'p1', tierPrice: 5500 }] }));
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', ['p1'], [10]);
    expect(out.prices.get('p1')).toEqual({ tierPrice: 5500 });
  });
});

describe('coordination adapters short-circuit when disabled', () => {
  it('recommendation is a no-op when the base URL is blank (never fetches)', async () => {
    await new RecommendationCoordinationHttpAdapter(
      makeConfig({ recommendationServiceUrl: '' }),
    ).recordCompleted(order());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forecast is a no-op when the base URL is blank (never fetches)', async () => {
    await new ForecastCoordinationHttpAdapter(
      makeConfig({ forecastServiceUrl: '' }),
    ).ingestCompletedOrder(order());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // B-6b: this used to assert that reserve SKIPS when the internal key is missing, which
  // meant a blank config value quietly sold unreserved stock on every order. A missing key
  // is a deployment fault, so it now rejects the checkout like any other non-verdict.
  it('inventory.reserve refuses to proceed without an internal key', async () => {
    await expect(
      new InventoryHttpAdapter(makeConfig({ internalServiceKey: '' })).reserve('d1', 'o1', line, ''),
    ).rejects.toBeInstanceOf(StockCheckUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('inventory.release skips on empty items', async () => {
    await new InventoryHttpAdapter(makeConfig()).release('d1', 'o1', [] as never, '');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('edge-case parsing branches', () => {
  it('reseller-discount throws->fails-open to null on a 500', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await new ResellerDiscountHttpAdapter(makeConfig()).get('Bearer t')).toBeNull();
  });

  it('reseller-discount returns null when discountPct is not a finite number', async () => {
    fetchMock.mockResolvedValue(res({ ok: true, body: { active: true, discountPct: 'x' } }));
    expect(await new ResellerDiscountHttpAdapter(makeConfig()).get('Bearer t')).toBeNull();
  });

  it('promo.quote falls back to a generic reject message when the body has none', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 400, body: {} }));
    await expect(
      new PromoHttpAdapter(makeConfig()).quote('X', 'c1', 1, 0, 'Bearer t'),
    ).rejects.toThrow('This voucher could not be applied.');
  });

  it('depot-pricing defaults a missing adjust value to 0', async () => {
    fetchMock.mockResolvedValue(
      res({ ok: true, body: [{ productId: 'p1', adjustType: 'PERCENT' }] }),
    );
    const out = await new DepotPricingHttpAdapter(makeConfig()).getPrices('d1', ['p1']);
    expect(out.prices.get('p1')).toEqual({ adjustType: 'PERCENT', value: 0 });
  });
});
