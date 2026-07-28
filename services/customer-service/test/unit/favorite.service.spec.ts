import { NotFoundException } from '@nestjs/common';

import { FavoriteService } from '../../src/application/services/favorite.service';
import { ProductCatalogPort } from '../../src/application/ports/product-catalog.port';
import { InMemoryFavoriteRepository } from '../support/fakes';

/** Knows every id except those explicitly listed as unknown. */
class FakeCatalog implements ProductCatalogPort {
  constructor(private readonly unknown: string[] = []) {}
  async exists(productId: string): Promise<boolean> {
    return !this.unknown.includes(productId);
  }
}

describe('FavoriteService', () => {
  let repo: InMemoryFavoriteRepository;
  let service: FavoriteService;
  const CUST = 'cust-1';

  beforeEach(() => {
    repo = new InMemoryFavoriteRepository();
    service = new FavoriteService(repo, new FakeCatalog());
  });

  it('rejects a product the catalog does not know (UAT-M27-13)', async () => {
    const guarded = new FavoriteService(repo, new FakeCatalog(['ghost']));
    await expect(guarded.add(CUST, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(await guarded.list(CUST)).toEqual([]);
  });

  it('still adds when the catalog check passes', async () => {
    const guarded = new FavoriteService(repo, new FakeCatalog(['ghost']));
    expect(await guarded.add(CUST, 'p1')).toEqual(['p1']);
  });

  it('adds a favorite and returns the updated list', async () => {
    const list = await service.add(CUST, 'p1');
    expect(list).toEqual(['p1']);
  });

  it('is idempotent: re-adding the same product does not error or duplicate', async () => {
    await service.add(CUST, 'p1');
    const list = await service.add(CUST, 'p1');
    expect(list).toEqual(['p1']);
  });

  it('lists favorites newest first', async () => {
    await service.add(CUST, 'p1');
    await service.add(CUST, 'p2');
    await service.add(CUST, 'p3');
    expect(await service.list(CUST)).toEqual(['p3', 'p2', 'p1']);
  });

  it('removes a favorite', async () => {
    await service.add(CUST, 'p1');
    await service.add(CUST, 'p2');
    await service.remove(CUST, 'p1');
    expect(await service.list(CUST)).toEqual(['p2']);
  });

  it('remove is a no-op for a non-existent favorite (not an error)', async () => {
    await service.add(CUST, 'p1');
    await expect(service.remove(CUST, 'missing')).resolves.toBeUndefined();
    expect(await service.list(CUST)).toEqual(['p1']);
  });

  it('does not leak another customer’s favorites', async () => {
    await service.add(CUST, 'p1');
    await service.add('other', 'p2');
    expect(await service.list(CUST)).toEqual(['p1']);
    await service.remove('other', 'p1'); // wrong tenant can't remove mine
    expect(await service.list(CUST)).toEqual(['p1']);
  });
});
