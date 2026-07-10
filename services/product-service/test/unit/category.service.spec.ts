import { CategoryService } from '../../src/application/services/category.service';
import { CategoryNotFoundError, DuplicateSlugError } from '../../src/domain/errors';
import { InMemoryCategoryRepository } from '../support/fakes';

describe('CategoryService', () => {
  let repo: InMemoryCategoryRepository;
  let service: CategoryService;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    service = new CategoryService(repo);
  });

  it('creates and lists active categories', async () => {
    await service.create({ name: 'Air Minum', slug: 'air-minum', sortOrder: 0 });
    const list = await service.list(true);
    expect(list).toHaveLength(1);
  });

  it('rejects a duplicate slug', async () => {
    await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    await expect(service.create({ name: 'Air 2', slug: 'air', sortOrder: 1 })).rejects.toBeInstanceOf(
      DuplicateSlugError,
    );
  });

  it('soft-deletes (deactivates) a category', async () => {
    const c = await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    await service.deactivate(c.id);
    expect(await service.list(true)).toHaveLength(0);
    expect(await service.list(false)).toHaveLength(1);
  });

  it('throws for an unknown category', async () => {
    await expect(service.getOrThrow('missing')).rejects.toBeInstanceOf(CategoryNotFoundError);
  });
});
