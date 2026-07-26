import { ApiKeyNotFoundError } from '../../src/domain/errors';
import { ApiKeyService } from '../../src/application/services/api-key.service';
import { ApiKeyRepository } from '../../src/application/ports/api-key.repository';
import { makeApiKey } from '../support/fakes';

// Gap-fill: rotate()'s second guard — the key is present in list() but repo.rotate() returns
// null (a concurrent revoke/delete between the read and the write). The existing spec only
// covers the first guard (key absent from list()).
describe('ApiKeyService.rotate race guard', () => {
  it('throws ApiKeyNotFoundError when the key vanishes between list and rotate', async () => {
    const record = makeApiKey({ id: 'k-1' });
    const repo: ApiKeyRepository = {
      list: jest.fn().mockResolvedValue([record]),
      create: jest.fn(),
      rotate: jest.fn().mockResolvedValue(null),
      revoke: jest.fn(),
    };
    const service = new ApiKeyService(repo);
    await expect(service.rotate('k-1')).rejects.toBeInstanceOf(ApiKeyNotFoundError);
    expect(repo.rotate).toHaveBeenCalled();
  });
});
