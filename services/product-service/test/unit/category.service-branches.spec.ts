import { CategoryService } from '../../src/application/services/category.service';
import { CategoryNotFoundError, DuplicateSlugError } from '../../src/domain/errors';
import { InMemoryCategoryRepository } from '../support/fakes';

describe('CategoryService.update branches', () => {
  let repo: InMemoryCategoryRepository;
  let service: CategoryService;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    service = new CategoryService(repo);
  });

  it('updates without touching the slug (patch.slug falsy)', async () => {
    const c = await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    const updated = await service.update(c.id, { name: 'Air Mineral' }, c.updatedAt.toISOString());
    expect(updated.name).toBe('Air Mineral');
    expect(updated.slug).toBe('air');
  });

  it('updates to a new, free slug', async () => {
    const c = await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    const updated = await service.update(c.id, { slug: 'air-baru' }, c.updatedAt.toISOString());
    expect(updated.slug).toBe('air-baru');
  });

  it('allows re-saving the same slug it already owns (owner.id === id)', async () => {
    const c = await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    const updated = await service.update(c.id, { slug: 'air', sortOrder: 5 }, c.updatedAt.toISOString());
    expect(updated.sortOrder).toBe(5);
  });

  it('rejects a slug already owned by another category', async () => {
    const a = await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    await service.create({ name: 'Gas', slug: 'gas', sortOrder: 1 });
    await expect(service.update(a.id, { slug: 'gas' }, a.updatedAt.toISOString())).rejects.toBeInstanceOf(DuplicateSlugError);
  });

  it('throws when updating an unknown category', async () => {
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });

  /* CA-2-53 — the same shape on a catalogue category. */
  it('refuses a category save built on a copy that is already out of date', async () => {
    const c = await service.create({ name: 'Air', slug: 'air', sortOrder: 0 });
    await service.update(c.id, { name: 'Air Mineral' }, c.updatedAt.toISOString());

    await expect(
      service.update(c.id, { name: 'Air Baru' }, c.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
  });
});
