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
    expect(out).toEqual({ active: true, discountPct: 10, flatGallonPriceIdr: 5000 });
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
        active: true,
        discountPct: 10,
        flatGallonPriceIdr: 0,
      });
    }
  });

  it('fails open to null on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toBeNull();
  });

  it('fails open to null on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toBeNull();
  });

  it('returns null when no authorization is supplied', async () => {
    global.fetch = jest.fn() as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
