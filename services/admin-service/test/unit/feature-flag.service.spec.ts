import { FlagState } from '../../src/domain/flag-state';
import { FeatureFlagNotFoundError } from '../../src/domain/errors';
import { FeatureFlagService } from '../../src/application/services/feature-flag.service';
import { InMemoryFeatureFlagRepository, makeFlag } from '../support/fakes';

describe('FeatureFlagService', () => {
  let repo: InMemoryFeatureFlagRepository;
  let service: FeatureFlagService;

  beforeEach(() => {
    repo = new InMemoryFeatureFlagRepository();
    service = new FeatureFlagService(repo);
  });

  it('lists flags ordered by key', async () => {
    repo.flags = [makeFlag({ key: 'b.flag' }), makeFlag({ key: 'a.flag' })];
    const list = await service.list();
    expect(list.map((f) => f.key)).toEqual(['a.flag', 'b.flag']);
  });

  it('updates a flag state by key', async () => {
    repo.flags = [makeFlag({ key: 'x', state: FlagState.OFF })];
    const updated = await service.update('x', { state: FlagState.ACTIVE });
    expect(updated.state).toBe(FlagState.ACTIVE);
  });

  it('updates rolloutPct, including clearing it with null', async () => {
    repo.flags = [makeFlag({ key: 'x', state: FlagState.ROLLOUT, rolloutPct: 10 })];
    expect((await service.update('x', { rolloutPct: 75 })).rolloutPct).toBe(75);
    expect((await service.update('x', { rolloutPct: null })).rolloutPct).toBeNull();
  });

  it('throws FeatureFlagNotFoundError for an unknown key', async () => {
    await expect(service.update('nope', { state: FlagState.ACTIVE })).rejects.toBeInstanceOf(
      FeatureFlagNotFoundError,
    );
  });
});
