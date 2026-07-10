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

  it('maps a 404 to null (product missing or inactive)', async () => {
    mockFetch(() => ({ status: 404, ok: false }));
    expect(await adapter.getProduct('missing')).toBeNull();
  });

  it('throws on a non-404 error response so checkout fails closed', async () => {
    mockFetch(() => ({ status: 500, ok: false }));
    await expect(adapter.getProduct('p1')).rejects.toThrow('product-service responded 500');
  });

  it('propagates a network failure', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(adapter.getProduct('p1')).rejects.toThrow('ECONNREFUSED');
  });
});
