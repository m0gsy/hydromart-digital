import { ProductService } from '../../src/application/services/product.service';
import {
  CategoryNotFoundError,
  DuplicateSkuError,
  ProductNotFoundError,
} from '../../src/domain/errors';
import {
  FakeStockNotifier,
  InMemoryCategoryRepository,
  InMemoryProductRepository,
} from '../support/fakes';

const base = (over: Partial<{ name: string; sku: string; categoryId: string | null }> = {}) => ({
  categoryId: over.categoryId ?? null,
  name: over.name ?? 'Air Galon 19L',
  sku: over.sku ?? 'AIR-19L',
  description: null,
  unit: 'Galon 19L',
  volumeMl: 19000,
  isGallon: true,
  basePrice: 20000,
  imageUrl: null,
  images: [],
});

describe('ProductService', () => {
  let products: InMemoryProductRepository;
  let categories: InMemoryCategoryRepository;
  let notifier: FakeStockNotifier;
  let service: ProductService;

  beforeEach(() => {
    products = new InMemoryProductRepository();
    categories = new InMemoryCategoryRepository();
    notifier = new FakeStockNotifier();
    service = new ProductService(products, categories, notifier);
  });

  it('creates a product and returns it', async () => {
    const p = await service.create(base());
    expect(p.id).toBeDefined();
    expect(p.active).toBe(true);
  });

  // Audit S-7 and its Q-17 baseline row: checkout resolves every cart line in one read.
  // Inactive or unknown ids are absent rather than fatal — the caller decides what a
  // missing line means, and one bad id must not fail the whole cart's resolution.
  it('resolves many products in one read', async () => {
    const a = await service.create(base({ sku: 'A' }));
    const b = await service.create(base({ sku: 'B', name: 'B' }));
    await service.update(b.id, { active: false });

    expect(await service.byIds([])).toEqual([]);
    const found = await service.byIds([a.id, b.id, '11111111-1111-1111-1111-111111111111']);
    expect(found.map((p) => p.id)).toEqual([a.id]);
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

  // Depot stock lines copy a product's name and unit when they are opened, so the catalog
  // has to say when either changes — otherwise every depot keeps showing the old name and
  // nothing in the system ever notices.
  describe('tells depot-service when a stock line would go stale', () => {
    it('pushes a rename with the new name', async () => {
      const p = await service.create(base({ name: 'Air Galon 19L' }));
      await service.update(p.id, { name: 'Air Galon 19,2L' });
      expect(notifier.changes).toEqual([
        { productId: p.id, name: 'Air Galon 19,2L', unit: p.unit, active: true },
      ]);
    });

    it('pushes a deactivation so the lines can be hidden', async () => {
      const p = await service.create(base());
      await service.deactivate(p.id);
      expect(notifier.changes).toEqual([
        expect.objectContaining({ productId: p.id, active: false }),
      ]);
    });

    // A price or a photo is not mirrored by any stock line; pushing on those would make a
    // busy catalog session hammer depot-service for nothing.
    it('stays quiet for an edit no stock line mirrors', async () => {
      const p = await service.create(base());
      await service.update(p.id, { basePrice: 25000, description: 'baru' });
      expect(notifier.changes).toHaveLength(0);
    });

    // The catalog write has already committed by then.
    it('still returns the updated product when the push fails', async () => {
      const p = await service.create(base());
      notifier.throws = true;
      await expect(service.update(p.id, { name: 'Nama Baru' })).resolves.toMatchObject({
        name: 'Nama Baru',
      });
      await expect(service.deactivate(p.id)).resolves.toMatchObject({ active: false });
    });
  });
});
