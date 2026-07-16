import { ApiKeyEnvironment } from '../../src/domain/api-key-environment';
import { ApiKeyNotFoundError } from '../../src/domain/errors';
import { hashApiKey } from '../../src/domain/api-key-token';
import { ApiKeyService } from '../../src/application/services/api-key.service';
import { InMemoryApiKeyRepository } from '../support/fakes';

describe('ApiKeyService', () => {
  let repo: InMemoryApiKeyRepository;
  let service: ApiKeyService;

  beforeEach(() => {
    repo = new InMemoryApiKeyRepository();
    service = new ApiKeyService(repo);
  });

  it('returns the full secret once on create and stores only the prefix', async () => {
    const { record, token } = await service.create({
      name: 'Gateway',
      scopes: ['payments:read'],
      environment: ApiKeyEnvironment.PROD,
    });
    expect(token).toMatch(/^hm_live_/);
    expect(record.keyPrefix).toBe(token.slice(0, 16));
    // The record type has no field for the secret or its hash.
    expect(record).not.toHaveProperty('token');
    expect(record).not.toHaveProperty('keyHash');
  });

  it('uses a staging prefix segment for STAGING keys', async () => {
    const { token } = await service.create({
      name: 'Staging',
      scopes: ['orders:read'],
      environment: ApiKeyEnvironment.STAGING,
    });
    expect(token).toMatch(/^hm_test_/);
  });

  it('rotates a key: new secret, prefix changes, environment preserved', async () => {
    const created = await service.create({
      name: 'Staging',
      scopes: ['orders:read'],
      environment: ApiKeyEnvironment.STAGING,
    });
    const rotated = await service.rotate(created.record.id);
    expect(rotated.token).not.toBe(created.token);
    expect(rotated.token).toMatch(/^hm_test_/); // env preserved on rotate
    expect(rotated.record.keyPrefix).toBe(rotated.token.slice(0, 16));
  });

  it('revokes a key by id', async () => {
    const created = await service.create({
      name: 'Gateway',
      scopes: ['payments:read'],
      environment: ApiKeyEnvironment.PROD,
    });
    const revoked = await service.revoke(created.record.id);
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('throws ApiKeyNotFoundError for unknown ids on rotate and revoke', async () => {
    await expect(service.rotate('nope')).rejects.toBeInstanceOf(ApiKeyNotFoundError);
    await expect(service.revoke('nope')).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });

  it('hashApiKey is stable for the same token', () => {
    expect(hashApiKey('hm_live_abc')).toBe(hashApiKey('hm_live_abc'));
  });
});
