import { ProductController } from '../../src/modules/product.controller';
import { ProductService } from '../../src/application/services/product.service';
import {
  BrowseProductsQueryDto,
  CreateProductDto,
  UpdateProductDto,
} from '../../src/modules/dto/product.dto';

describe('ProductController', () => {
  const service = {
    browse: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    get: jest.fn().mockResolvedValue({ id: 'p1' }),
    create: jest.fn().mockResolvedValue({ id: 'p1' }),
    update: jest.fn().mockResolvedValue({ id: 'p1' }),
    deactivate: jest.fn().mockResolvedValue({ id: 'p1' }),
    byIds: jest.fn().mockResolvedValue([]),
  };
  const controller = new ProductController(service as unknown as ProductService);

  afterEach(() => jest.clearAllMocks());

  it('browse delegates query with activeOnly=true', async () => {
    const query: BrowseProductsQueryDto = { page: 2, limit: 10 };
    await controller.browse(query);
    expect(service.browse).toHaveBeenCalledWith(query, true);
  });

  // The console's only product list. If this ever filtered to active products the
  // operator would lose sight of anything deactivated, with no way to switch it back.
  it('browseAll delegates query with activeOnly=false', async () => {
    const query: BrowseProductsQueryDto = { page: 1, limit: 100 };
    await controller.browseAll(query);
    expect(service.browse).toHaveBeenCalledWith(query, false);
  });

  // Audit S-7: comma-separated ids, blanks dropped. A caller that sends nothing at all
  // gets an empty list rather than a 500.
  it('batch splits the id list and asks once', async () => {
    await controller.batch('p1, p2 ,,p3');
    expect(service.byIds).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
    await controller.batch(undefined as unknown as string);
    expect(service.byIds).toHaveBeenLastCalledWith([]);
  });

  it('get delegates id with activeOnly=true', async () => {
    await controller.get('p1');
    expect(service.get).toHaveBeenCalledWith('p1', true);
  });

  it('create maps a full dto', async () => {
    const dto: CreateProductDto = {
      categoryId: 'cat-1',
      name: 'Galon',
      sku: 'GAL-19',
      description: 'desc',
      unit: 'Galon',
      basePrice: 20000,
      imageUrl: 'http://x/img.png',
    };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith({
      categoryId: 'cat-1',
      name: 'Galon',
      sku: 'GAL-19',
      description: 'desc',
      unit: 'Galon',
      volumeMl: null,
      isGallon: false,
      basePrice: 20000,
      imageUrl: 'http://x/img.png',
      images: [],
    });
  });

  it('create defaults optional fields to null when omitted', async () => {
    const dto: CreateProductDto = {
      name: 'Galon',
      sku: 'GAL-19',
      unit: 'Galon',
      basePrice: 20000,
    };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith({
      categoryId: null,
      name: 'Galon',
      sku: 'GAL-19',
      description: null,
      unit: 'Galon',
      volumeMl: null,
      isGallon: false,
      basePrice: 20000,
      imageUrl: null,
      images: [],
    });
  });

  it('update delegates id and dto', async () => {
    const dto: UpdateProductDto = { name: 'New' };
    await controller.update('p1', dto);
    expect(service.update).toHaveBeenCalledWith('p1', dto);
  });

  it('remove delegates to deactivate', async () => {
    await controller.remove('p1');
    expect(service.deactivate).toHaveBeenCalledWith('p1');
  });
});
