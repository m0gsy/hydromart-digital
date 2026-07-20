import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ProductPrismaRepository } from '../../src/infrastructure/prisma/product.prisma.repository';
import { CategoryPrismaRepository } from '../../src/infrastructure/prisma/category.prisma.repository';

const productRow = () => ({
  id: 'prod-1',
  categoryId: 'cat-1',
  name: 'Galon 19L',
  sku: 'GAL-19',
  description: null,
  unit: 'galon',
  basePrice: { toNumber: () => 20000 },
  imageUrl: 'primary.jpg',
  images: ['extra-1.jpg', 'extra-2.jpg'],
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});

describe('ProductPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { product: model } as unknown as PrismaService;
  const repo = new ProductPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('searches with no filters and maps the Decimal basePrice to a number', async () => {
    model.findMany.mockResolvedValue([productRow()]);
    model.count.mockResolvedValue(1);

    const result = await repo.search({ page: 1, limit: 20, activeOnly: false });

    expect(result.total).toBe(1);
    expect(result.items[0].basePrice).toBe(20000);
    expect(result.items[0].images).toEqual(['extra-1.jpg', 'extra-2.jpg']);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(model.count).toHaveBeenCalledWith({ where: {} });
  });

  it('builds the full where clause and pagination for filtered searches', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);

    const result = await repo.search({
      page: 3,
      limit: 10,
      categoryId: 'cat-1',
      search: 'gal',
      activeOnly: true,
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(model.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        categoryId: 'cat-1',
        OR: [
          { name: { contains: 'gal', mode: 'insensitive' } },
          { sku: { contains: 'gal', mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 10,
    });
  });

  it('findById scopes to active when activeOnly is true', async () => {
    model.findFirst.mockResolvedValue(productRow());
    const record = await repo.findById('prod-1', true);
    expect(record?.basePrice).toBe(20000);
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: 'prod-1', active: true } });
  });

  it('findById omits the active scope when activeOnly is false', async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await repo.findById('missing', false)).toBeNull();
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: 'missing' } });
  });

  it('findBySku maps a hit and returns null on a miss', async () => {
    model.findUnique.mockResolvedValueOnce(productRow());
    expect((await repo.findBySku('GAL-19'))?.id).toBe('prod-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { sku: 'GAL-19' } });

    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findBySku('none')).toBeNull();
  });

  it('creates a product and returns the mapped record', async () => {
    model.create.mockResolvedValue(productRow());
    const data = {
      categoryId: 'cat-1',
      name: 'Galon 19L',
      sku: 'GAL-19',
      description: null,
      unit: 'galon',
      basePrice: 20000,
      imageUrl: null,
      images: [],
    };
    const record = await repo.create(data);
    expect(record.basePrice).toBe(20000);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('updates a product and returns the mapped record', async () => {
    model.update.mockResolvedValue(productRow());
    const record = await repo.update('prod-1', { active: false });
    expect(record.basePrice).toBe(20000);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'prod-1' }, data: { active: false } });
  });
});

describe('CategoryPrismaRepository', () => {
  const categoryRow = () => ({
    id: 'cat-1',
    name: 'Air Galon',
    slug: 'air-galon',
    sortOrder: 1,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  const model = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { category: model } as unknown as PrismaService;
  const repo = new CategoryPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('lists only active categories when activeOnly is true', async () => {
    model.findMany.mockResolvedValue([categoryRow()]);
    const list = await repo.list(true);
    expect(list).toHaveLength(1);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('lists all categories when activeOnly is false', async () => {
    model.findMany.mockResolvedValue([]);
    await repo.list(false);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('findById delegates to findUnique', async () => {
    model.findUnique.mockResolvedValue(categoryRow());
    expect((await repo.findById('cat-1'))?.slug).toBe('air-galon');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'cat-1' } });
  });

  it('findBySlug returns null when not found', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findBySlug('missing')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { slug: 'missing' } });
  });

  it('creates a category', async () => {
    model.create.mockResolvedValue(categoryRow());
    const data = { name: 'Air Galon', slug: 'air-galon', sortOrder: 1 };
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('updates a category', async () => {
    model.update.mockResolvedValue(categoryRow());
    await repo.update('cat-1', { active: false });
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'cat-1' }, data: { active: false } });
  });
});
