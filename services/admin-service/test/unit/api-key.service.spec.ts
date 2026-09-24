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

  /*
   * ADM-5. Rotation used to clear `revokedAt`, so the button labelled "rotate" quietly
   * undid a revocation: the same partner got a working credential back, and nothing on the
   * screen said a security decision had been reversed. Revoking is final; a partner who
   * needs access again gets a new key, which is a decision somebody makes on purpose.
   */
  it('refuses to rotate a key that was revoked', async () => {
    const created = await service.create({
      name: 'Gateway',
      scopes: ['payments:read'],
      environment: ApiKeyEnvironment.PROD,
    });
    await service.revoke(created.record.id);

    await expect(service.rotate(created.record.id)).rejects.toThrow(/dicabut/);
  });

  it('gives every new and rotated key an end date', async () => {
    const created = await service.create({
      name: 'Gateway',
      scopes: ['payments:read'],
      environment: ApiKeyEnvironment.PROD,
    });
    expect(created.record.expiresAt).toBeInstanceOf(Date);
    expect(created.record.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    const rotated = await service.rotate(created.record.id, 30);
    const days = (rotated.record.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
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
