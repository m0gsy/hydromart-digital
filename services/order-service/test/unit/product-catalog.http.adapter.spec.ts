import { CatalogUnavailableError } from '../../src/domain/errors';
import { ProductCatalogHttpAdapter } from '../../src/infrastructure/http/product-catalog.http.adapter';
import { buildTestConfig } from '../support/fakes';

describe('ProductCatalogHttpAdapter', () => {
  const adapter = new ProductCatalogHttpAdapter(buildTestConfig());
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = (impl: () => Partial<Response>): void => {
    global.fetch = jest.fn(async () => impl() as Response) as unknown as typeof fetch;
  };

  it('maps a 200 response to a catalog product', async () => {
    mockFetch(() => ({
      status: 200,
      ok: true,
      json: async () => ({
        id: 'p1',
        name: 'Air Galon 19L',
        sku: 'AIR-19L',
        unit: 'Galon 19L',
        basePrice: 20000,
        active: true,
      }),
    }));
    const product = await adapter.getProduct('p1');
    expect(product).toMatchObject({ id: 'p1', basePrice: 20000, active: true });
  });

  // Audit S-7: one call for a whole cart. It used to be one HTTP request per cart line.
  it('resolves a whole cart in one call', async () => {
    // No request at all for an empty cart.
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await adapter.getProducts([])).toEqual(new Map());
    expect(global.fetch).not.toHaveBeenCalled();

    mockFetch(() => ({
      status: 200,
      ok: true,
      json: async () => [
        { id: 'p1', name: 'A', sku: 'A', unit: 'Galon', basePrice: 20000, active: true },
        { id: 'p2', name: 'B', sku: 'B', unit: 'Botol', basePrice: 5000, active: true },
      ],
    }));
    const found = await adapter.getProducts(['p1', 'p2', 'p3']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect([...found.keys()]).toEqual(['p1', 'p2']); // p3 is simply absent
    expect(found.get('p1')).toMatchObject({ basePrice: 20000, volumeMl: null, isGallon: false });
  });

  it('throws on a failed batch so checkout fails closed', async () => {
    mockFetch(() => ({ status: 500, ok: false }));
    await expect(adapter.getProducts(['p1'])).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it('maps a 404 to null (product missing or inactive)', async () => {
    mockFetch(() => ({ status: 404, ok: false }));
    expect(await adapter.getProduct('missing')).toBeNull();
  });

  it('throws on a non-404 error response so checkout fails closed', async () => {
    mockFetch(() => ({ status: 500, ok: false }));
    await expect(adapter.getProduct('p1')).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it('propagates a network failure as an upstream outage, not a bug in the request', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(adapter.getProduct('p1')).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  /*
   * The 429-as-500. Every non-ok status left here as a bare `Error`, and the exception
   * filter renders those as 500 INTERNAL_ERROR / "An unexpected error occurred." So a
   * customer adding a galon to their cart while product-service was being throttled was
   * told the system had broken, with no reason and nothing to do about it. It had not
   * broken: it was busy, the customer had done nothing wrong, and trying again in a moment
   * would have worked. 503 and a sentence that says exactly that.
   *
   * The sibling adapter got this right already — `inventory.http.adapter` maps the same
   * failures to StockCheckUnavailableError. This one was the only rethrowing adapter in
   * order-service still handing the filter a bare Error.
   */
  it.each([429, 502, 503, 504])('maps upstream %i to a retryable 503, not a 500', async (status) => {
    mockFetch(() => ({ status, ok: false }));
    const err = await adapter.getProduct('p1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogUnavailableError);
    expect((err as CatalogUnavailableError).status).toBe(503);
    expect((err as CatalogUnavailableError).code).toBe('ORDER_CATALOG_UNAVAILABLE');
    // Said in the language of the person reading it, and honest about what to do next.
    expect((err as CatalogUnavailableError).message).toMatch(/coba lagi/i);
  });
});
