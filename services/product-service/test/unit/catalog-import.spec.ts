import { plainToInstance } from 'class-transformer';

import { ImportCategoriesDto, ImportCategoryRowDto } from '../../src/modules/dto/category.dto';
import { ImportProductRowDto, ImportProductsDto } from '../../src/modules/dto/product.dto';
import { CategoryController } from '../../src/modules/category.controller';
import { ProductController } from '../../src/modules/product.controller';
import { CategoryService } from '../../src/application/services/category.service';
import { ProductService } from '../../src/application/services/product.service';

const category = { id: 'cat-1', slug: 'air-minum' };

function products(opts: { skuTaken?: string[]; categories?: Record<string, unknown> } = {}) {
  const created: Record<string, unknown>[] = [];
  const productRepo = {
    findBySku: jest.fn(async (sku: string) => (opts.skuTaken?.includes(sku) ? { id: 'x' } : null)),
    create: jest.fn(async (data: Record<string, unknown>) => {
      created.push(data);
      return { id: `p-${created.length}`, ...data };
    }),
  };
  const categoryRepo = {
    findById: jest.fn(async () => category),
    findBySlug: jest.fn(async (slug: string) => (opts.categories ?? { 'air-minum': category })[slug] ?? null),
  };
  const svc = new ProductService(productRepo as never, categoryRepo as never, {} as never);
  return { svc, created, productRepo };
}

describe('product import', () => {
  it('creates each row, resolving the category by slug', async () => {
    const { svc, created } = products();
    const r = await svc.importRows([
      { sku: 'AIR-19', name: 'Air 19L', unit: 'Galon 19L', basePrice: 18000, categorySlug: 'air-minum', volumeMl: 19000, isGallon: true },
      { sku: 'TUTUP-1', name: 'Tutup', unit: 'pcs', basePrice: 500 },
    ]);
    expect(r).toMatchObject({ created: 2, skipped: 0, failed: 0 });
    expect(created[0]).toMatchObject({ categoryId: 'cat-1', isGallon: true, volumeMl: 19000, basePrice: 18000 });
    expect(created[1]).toMatchObject({ categoryId: null, isGallon: false, volumeMl: null, description: null });
  });

  it('an existing SKU is skipped, an unknown category fails only its row', async () => {
    const { svc } = products({ skuTaken: ['DUP'] });
    const r = await svc.importRows([
      { sku: 'DUP', name: 'x', unit: 'u', basePrice: 1 },
      { sku: 'NEW', name: 'y', unit: 'u', basePrice: 1, categorySlug: 'nope' },
      { sku: 'OK', name: 'z', unit: 'u', basePrice: 1 },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['skipped', 'failed', 'created']);
    expect(r.results[1].message).toMatch(/nope/);
  });
});

describe('category import', () => {
  function build(taken: string[] = []) {
    const create = jest.fn(async (d: Record<string, unknown>) => ({ id: 'c1', ...d }));
    const repo = {
      findBySlug: async (slug: string) => (taken.includes(slug) ? { id: 'old' } : null),
      create,
    };
    return { svc: new CategoryService(repo as never), create };
  }

  it('creates, defaults the order to 0 and skips an existing slug', async () => {
    const { svc, create } = build(['air-minum']);
    const r = await svc.importRows([
      { name: 'Air', slug: 'air-minum' },
      { name: 'Tutup', slug: 'tutup', sortOrder: 4 },
      { name: 'Segel', slug: 'segel' },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['skipped', 'created', 'created']);
    expect(create.mock.calls.map((c) => c[0].sortOrder)).toEqual([4, 0]);
  });
});

describe('import routes', () => {
  it('hand the rows to the services', async () => {
    const productSvc = { importRows: jest.fn().mockResolvedValue('p') };
    const categorySvc = { importRows: jest.fn().mockResolvedValue('c') };
    const rows = [{ sku: 'a' }] as never;
    await new ProductController(productSvc as never).import({ rows });
    await new CategoryController(categorySvc as never).import({ rows });
    expect(productSvc.importRows).toHaveBeenCalledWith(rows);
    expect(categorySvc.importRows).toHaveBeenCalledWith(rows);
  });
});

describe('import DTOs', () => {
  it('turn plain rows into typed row objects', () => {
    const p = plainToInstance(ImportProductsDto, { rows: [{ sku: 'a', basePrice: '100' }] });
    expect(p.rows[0]).toBeInstanceOf(ImportProductRowDto);
    expect(p.rows[0].basePrice).toBe(100);
    const c = plainToInstance(ImportCategoriesDto, { rows: [{ slug: 'a', sortOrder: '2' }] });
    expect(c.rows[0]).toBeInstanceOf(ImportCategoryRowDto);
    expect(c.rows[0].sortOrder).toBe(2);
  });
});
