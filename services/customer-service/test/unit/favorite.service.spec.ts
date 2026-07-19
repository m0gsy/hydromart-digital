import { FavoriteService } from '../../src/application/services/favorite.service';
import { InMemoryFavoriteRepository } from '../support/fakes';

describe('FavoriteService', () => {
  let repo: InMemoryFavoriteRepository;
  let service: FavoriteService;
  const CUST = 'cust-1';

  beforeEach(() => {
    repo = new InMemoryFavoriteRepository();
    service = new FavoriteService(repo);
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
