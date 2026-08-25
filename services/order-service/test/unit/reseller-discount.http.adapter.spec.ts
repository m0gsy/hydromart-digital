import { ResellerDiscountHttpAdapter } from '../../src/infrastructure/http/reseller-discount.http.adapter';

const config = { customerServiceUrl: 'http://customer' } as never;

describe('ResellerDiscountHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns pricing when the endpoint answers 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ active: true, discountPct: 10, flatGallonPriceIdr: 5000 }),
    }) as never;
    const out = await new ResellerDiscountHttpAdapter(config).get('Bearer t');
    // A5: the pricing now arrives wrapped, so the caller can tell a 404 from an outage.
    expect(out).toEqual({
      reseller: { active: true, discountPct: 10, flatGallonPriceIdr: 5000, homeDepotId: null },
      unavailable: false,
    });
  });

  /*
   * A6/A9. The counter read is a different call in every way that matters: internal key
   * instead of the cashier's bearer (whose role is not in `resellerView` — measured 403),
   * and it throws instead of answering "not a reseller" when the read fails.
   */
  describe('the counter read (getFor)', () => {
    const withKey = { customerServiceUrl: 'http://customer', internalServiceKey: 'k' } as never;

    it('reads the internal route on the internal key, and carries the home depot', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ active: true, discountPct: 0, flatGallonPriceIdr: 5000, homeDepotId: 'd1' }),
      });
      global.fetch = fetchMock as never;

      await expect(new ResellerDiscountHttpAdapter(withKey).getFor('c1')).resolves.toEqual({
        active: true,
        discountPct: 0,
        flatGallonPriceIdr: 5000,
        homeDepotId: 'd1',
      });
      expect(fetchMock.mock.calls[0][0]).toBe('http://customer/api/v1/customers/internal/reseller/c1');
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-internal-key': 'k' });
    });

    it('answers null for 404 — "not an agen" is a real answer', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
      await expect(new ResellerDiscountHttpAdapter(withKey).getFor('c1')).resolves.toBeNull();
    });

    // The whole point of A6: a failed read must not read as "charge them retail".
    it('throws on a failed read rather than charging the agen full price', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as never;
      await expect(new ResellerDiscountHttpAdapter(withKey).getFor('c1')).rejects.toThrow(/500/);
    });

    // A6's silent-release trap: no key means every call 401s and the counter quietly
    // reverts to retail. It refuses loudly instead, before any request goes out.
    it('refuses before calling when INTERNAL_SERVICE_KEY is not set', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as never;
      await expect(
        new ResellerDiscountHttpAdapter({ customerServiceUrl: 'http://customer', internalServiceKey: '' } as never).getFor('c1'),
      ).rejects.toThrow(/INTERNAL_SERVICE_KEY/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // A customer-service that predates the column sends no field at all. 0 means "price by
  // percent", which is what those rows already meant — never a pricing surprise.
  it('reads a missing or nonsensical flat galon price as 0', async () => {
    for (const body of [
      { active: true, discountPct: 10 },
      { active: true, discountPct: 10, flatGallonPriceIdr: 'nope' },
      { active: true, discountPct: 10, flatGallonPriceIdr: -500 },
    ]) {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as never;
      expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toEqual({
        reseller: { active: true, discountPct: 10, flatGallonPriceIdr: 0, homeDepotId: null },
        unavailable: false,
      });
    }
  });

  it('answers "not an agen" on 404 — and does NOT call it an outage', async () => {
    // A5: this is the distinction the whole item is about. A 404 is customer-service
    // answering; marking the order here would send someone hunting an incident that never
    // happened.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toEqual({
      reseller: null,
      unavailable: false,
    });
  });

  it('still fails OPEN on a network error, but says it was unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toEqual({
      reseller: null,
      unavailable: true,
    });
  });

  it('asks nothing, and blames nothing, when there is no token', async () => {
    // An anonymous checkout has no agen pricing to read. `unavailable: true` here would
    // accuse customer-service of being down for a question nobody asked it.
    global.fetch = jest.fn() as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('')).toEqual({
      reseller: null,
      unavailable: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
