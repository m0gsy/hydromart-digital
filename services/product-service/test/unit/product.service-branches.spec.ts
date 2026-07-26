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

describe('ProductService.update branches', () => {
  let products: InMemoryProductRepository;
  let categories: InMemoryCategoryRepository;
  let service: ProductService;

  beforeEach(() => {
    products = new InMemoryProductRepository();
    categories = new InMemoryCategoryRepository();
    service = new ProductService(products, categories);
  });

  it('updates without touching sku or category', async () => {
    const p = await service.create(base());
    const updated = await service.update(p.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });

  it('updates to a new, free sku', async () => {
    const p = await service.create(base({ sku: 'OLD' }));
    const updated = await service.update(p.id, { sku: 'NEW' });
    expect(updated.sku).toBe('NEW');
  });

  it('allows re-saving the same sku it already owns (owner.id === id)', async () => {
    const p = await service.create(base({ sku: 'KEEP' }));
    const updated = await service.update(p.id, { sku: 'KEEP', name: 'Same SKU' });
    expect(updated.name).toBe('Same SKU');
  });

  it('rejects a sku already owned by another product', async () => {
    const a = await service.create(base({ sku: 'A' }));
    await service.create(base({ sku: 'B', name: 'other' }));
    await expect(service.update(a.id, { sku: 'B' })).rejects.toBeInstanceOf(DuplicateSkuError);
  });

  it('assigns a valid category on update', async () => {
    const cat = await categories.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    const p = await service.create(base());
    const updated = await service.update(p.id, { categoryId: cat.id });
    expect(updated.categoryId).toBe(cat.id);
  });

  it('clears the category on update (categoryId null but defined)', async () => {
    const cat = await categories.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    const p = await service.create(base({ categoryId: cat.id }));
    const updated = await service.update(p.id, { categoryId: null });
    expect(updated.categoryId).toBeNull();
  });

  it('rejects updating to a missing category', async () => {
    const p = await service.create(base());
    await expect(
      service.update(p.id, { categoryId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('throws when updating an unknown product', async () => {
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );
  });

  it('treats a blank search as no search filter', async () => {
    await service.create(base({ sku: 'A1', name: 'Air' }));
    const res = await service.browse({ search: '   ' }, true);
    expect(res.total).toBe(1);
  });
});
