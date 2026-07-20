import { ProductService } from '../../src/application/services/product.service';
import {
  CategoryNotFoundError,
  DuplicateSkuError,
  ProductNotFoundError,
} from '../../src/domain/errors';
import { InMemoryCategoryRepository, InMemoryProductRepository } from '../support/fakes';

const base = (over: Partial<{ name: string; sku: string; categoryId: string | null }> = {}) => ({
  categoryId: over.categoryId ?? null,
  name: over.name ?? 'Air Galon 19L',
  sku: over.sku ?? 'AIR-19L',
  description: null,
  unit: 'Galon 19L',
  basePrice: 20000,
  imageUrl: null,
  images: [],
});

describe('ProductService', () => {
  let products: InMemoryProductRepository;
  let categories: InMemoryCategoryRepository;
  let service: ProductService;

  beforeEach(() => {
    products = new InMemoryProductRepository();
    categories = new InMemoryCategoryRepository();
    service = new ProductService(products, categories);
  });

  it('creates a product and returns it', async () => {
    const p = await service.create(base());
    expect(p.id).toBeDefined();
    expect(p.active).toBe(true);
  });

  it('rejects a duplicate SKU', async () => {
    await service.create(base({ sku: 'DUP' }));
    await expect(service.create(base({ sku: 'DUP', name: 'other' }))).rejects.toBeInstanceOf(
      DuplicateSkuError,
    );
  });

  it('rejects a product referencing a missing category', async () => {
    await expect(
      service.create(base({ categoryId: '11111111-1111-1111-1111-111111111111' })),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('browses only active products with pagination and search', async () => {
    await service.create(base({ name: 'Air Galon 19L', sku: 'A1' }));
    await service.create(base({ name: 'Botol 600ml', sku: 'B1' }));
    const hidden = await service.create(base({ name: 'Air Botol', sku: 'C1' }));
    await service.deactivate(hidden.id);

    const all = await service.browse({ page: 1, limit: 10 }, true);
    expect(all.total).toBe(2);

    const searched = await service.browse({ search: 'air' }, true);
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0].sku).toBe('A1');
  });

  it('paginates', async () => {
    for (let i = 0; i < 25; i += 1) await service.create(base({ sku: `S${i}`, name: `P${i}` }));
    const page2 = await service.browse({ page: 2, limit: 20 }, true);
    expect(page2.items).toHaveLength(5);
    expect(page2.totalPages).toBe(2);
  });

  it('hides an inactive product from public get but not admin', async () => {
    const p = await service.create(base());
    await service.deactivate(p.id);
    await expect(service.get(p.id, true)).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(service.get(p.id, false)).resolves.toMatchObject({ id: p.id, active: false });
  });
});
