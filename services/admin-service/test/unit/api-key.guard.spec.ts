import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiKeyGuard, ApiScopes } from '../../src/modules/api-key.guard';
import { generateApiKey } from '../../src/domain/api-key-token';
import { ApiKeyEnvironment } from '../../src/domain/api-key-environment';
import { InMemoryApiKeyRepository } from '../support/fakes';

/** A context whose handler carries the scopes a real route would declare. */
function contextWith(headers: Record<string, string>, scopes?: string[]): ExecutionContext {
  class Handler {
    run(): void {}
  }
  if (scopes) ApiScopes(...scopes)(Handler.prototype, 'run', { value: Handler.prototype.run });
  const request = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Handler.prototype.run,
    getClass: () => Handler,
  } as unknown as ExecutionContext;
}

async function seedKey(repo: InMemoryApiKeyRepository, scopes: string[]) {
  const minted = generateApiKey(ApiKeyEnvironment.PROD);
  const record = await repo.create({
    name: 'partner',
    keyPrefix: minted.keyPrefix,
    keyHash: minted.keyHash,
    scopes,
    environment: ApiKeyEnvironment.PROD,
  });
  return { token: minted.token, record };
}

describe('ApiKeyGuard (H-30)', () => {
  let repo: InMemoryApiKeyRepository;
  let guard: ApiKeyGuard;

  beforeEach(() => {
    repo = new InMemoryApiKeyRepository();
    guard = new ApiKeyGuard(repo, new Reflector());
  });

  it('admits a live key that carries the required scope, and stamps it as used', async () => {
    const { token, record } = await seedKey(repo, ['webhooks:read']);

    await expect(
      guard.canActivate(contextWith({ 'x-api-key': token }, ['webhooks:read'])),
    ).resolves.toBe(true);
    // Stamped asynchronously so a slow write cannot delay the partner's response.
    await Promise.resolve();
    expect(repo.keys.find((k) => k.id === record.id)!.lastUsedAt).toBeInstanceOf(Date);
  });

  it('refuses a request with no key at all', async () => {
    await expect(guard.canActivate(contextWith({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // The stored value is a hash, so a key that was never issued and a wrong key take the
  // same path — nothing here tells an attacker which prefixes exist.
  it('refuses a key that was never issued', async () => {
    await seedKey(repo, ['webhooks:read']);
    await expect(
      guard.canActivate(contextWith({ 'x-api-key': 'hm_live_not-a-real-key' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a revoked key — revocation has to mean something', async () => {
    const { token, record } = await seedKey(repo, ['webhooks:read']);
    await repo.revoke(record.id);

    await expect(
      guard.canActivate(contextWith({ 'x-api-key': token }, ['webhooks:read'])),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a live key that lacks the route scope, and names what is missing', async () => {
    const { token } = await seedKey(repo, ['webhooks:read']);

    await expect(
      guard.canActivate(contextWith({ 'x-api-key': token }, ['webhooks:write'])),
    ).rejects.toThrow(/webhooks:write/);
    await expect(
      guard.canActivate(contextWith({ 'x-api-key': token }, ['webhooks:write'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admits a scopeless route for any live key', async () => {
    const { token } = await seedKey(repo, []);
    await expect(guard.canActivate(contextWith({ 'x-api-key': token }))).resolves.toBe(true);
  });

  it('reads the first value when the header arrives more than once', async () => {
    const { token } = await seedKey(repo, ['webhooks:read']);
    const ctx = contextWith({ 'x-api-key': [token, 'second'] as unknown as string }, [
      'webhooks:read',
    ]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('still admits the request when the last-used stamp fails', async () => {
    const { token } = await seedKey(repo, ['webhooks:read']);
    jest.spyOn(repo, 'touchLastUsed').mockRejectedValue(new Error('db down'));

    await expect(
      guard.canActivate(contextWith({ 'x-api-key': token }, ['webhooks:read'])),
    ).resolves.toBe(true);
  });
});
