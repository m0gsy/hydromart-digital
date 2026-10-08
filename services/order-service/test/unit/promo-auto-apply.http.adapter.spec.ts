import { PromoAutoApplyHttpAdapter } from '../../src/infrastructure/http/promo-auto-apply.http.adapter';
import { AutoApplyAppliedLine } from '../../src/application/ports/promo-auto-apply.port';
import { OrderConfigService } from '../../src/config/order-config.service';

const config = (overrides: Partial<OrderConfigService> = {}): OrderConfigService =>
  ({
    promoServiceUrl: 'http://promo-service',
    internalServiceKey: 'test-internal-key',
    ...overrides,
  }) as OrderConfigService;

describe('PromoAutoApplyHttpAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('quote', () => {
    it('forwards each line categoryId to the promo quote', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await adapter.quote('depot-1', 'APP', [{ productId: 'p1', categoryId: 'cat-1', quantity: 2, unitPrice: 8000 }]);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.lines[0]).toEqual({
        productId: 'p1',
        categoryId: 'cat-1',
        quantity: 2,
        unitPrice: 8000,
      });
      expect(body.depotId).toBe('depot-1');
      expect(body.channel).toBe('APP');
    });

    it('returns the parsed result on a 200', async () => {
      const expected = {
        lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 7000, freeQty: 0, lineTotal: 7000 }],
        shippingAppliedRuleId: null,
        shippingFeeOverride: null,
      };
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => expected }) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual(expected);
    });

    it('fails open (empty result) when fetch rejects', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null });
    });

    it('fails open when the response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null });
    });

    it('fails open when internalServiceKey is missing', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config({ internalServiceKey: '' }));
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    const appliedLine = (overrides: Partial<AutoApplyAppliedLine> = {}): AutoApplyAppliedLine => ({
      productId: 'p1',
      unitPrice: 8000,
      quantity: 1,
      appliedRuleIds: [],
      unitPriceAfter: 8000,
      freeQty: 0,
      ...overrides,
    });

    it('posts orderId + lines verbatim (no re-quoting) and resolves on success', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await expect(
        adapter.apply({ orderId: 'order-1', lines: [appliedLine({ appliedRuleIds: ['r1'], unitPriceAfter: 7000 })] }),
      ).resolves.toBeUndefined();
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.orderId).toBe('order-1');
      expect(body.lines[0]).toEqual({
        productId: 'p1',
        unitPrice: 8000,
        quantity: 1,
        appliedRuleIds: ['r1'],
        unitPriceAfter: 7000,
        freeQty: 0,
      });
    });

    it('includes shipping fields only when the caller supplied them', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await adapter.apply({
        orderId: 'order-1',
        lines: [appliedLine()],
        shippingAppliedRuleId: 'ship-rule',
        shippingFeeOverride: 1000,
        originalShippingFee: 2000,
        shippingUnits: 5,
      });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.shippingAppliedRuleId).toBe('ship-rule');
      expect(body.shippingFeeOverride).toBe(1000);
      expect(body.originalShippingFee).toBe(2000);
      expect(body.shippingUnits).toBe(5);
    });

    it('fails open (resolves) when fetch rejects', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await expect(adapter.apply({ orderId: 'order-1', lines: [] })).resolves.toBeUndefined();
    });

    it('fails open when internalServiceKey is missing', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config({ internalServiceKey: '' }));
      await expect(adapter.apply({ orderId: 'order-1', lines: [] })).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
