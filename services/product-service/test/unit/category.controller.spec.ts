import { CategoryController } from '../../src/modules/category.controller';
import { CategoryService } from '../../src/application/services/category.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../../src/modules/dto/category.dto';

describe('CategoryController', () => {
  const service = {
    list: jest.fn().mockResolvedValue([{ id: 'c1' }]),
    create: jest.fn().mockResolvedValue({ id: 'c1' }),
    update: jest.fn().mockResolvedValue({ id: 'c1' }),
    deactivate: jest.fn().mockResolvedValue({ id: 'c1' }),
  };
  const controller = new CategoryController(service as unknown as CategoryService);

  afterEach(() => jest.clearAllMocks());

  it('list delegates with activeOnly=true', async () => {
    await controller.list();
    expect(service.list).toHaveBeenCalledWith(true);
  });

  it('create maps dto with default sortOrder when omitted', async () => {
    const dto: CreateCategoryDto = { name: 'Air', slug: 'air' };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith({ name: 'Air', slug: 'air', sortOrder: 0 });
  });

  it('create passes through an explicit sortOrder', async () => {
    const dto: CreateCategoryDto = { name: 'Air', slug: 'air', sortOrder: 5 };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith({ name: 'Air', slug: 'air', sortOrder: 5 });
  });

  it('update delegates id and dto', async () => {
    const dto: UpdateCategoryDto = { name: 'New' };
    await controller.update('id-1', dto);
    expect(service.update).toHaveBeenCalledWith('id-1', dto);
  });

  it('remove delegates to deactivate', async () => {
    await controller.remove('id-1');
    expect(service.deactivate).toHaveBeenCalledWith('id-1');
  });
});
