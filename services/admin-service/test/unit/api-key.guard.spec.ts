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

async function seedKey(
  repo: InMemoryApiKeyRepository,
  scopes: string[],
  over: { environment?: ApiKeyEnvironment; expiresAt?: Date | null } = {},
) {
  const environment = over.environment ?? ApiKeyEnvironment.PROD;
  const minted = generateApiKey(environment);
  const record = await repo.create({
    name: 'partner',
    keyPrefix: minted.keyPrefix,
    keyHash: minted.keyHash,
    scopes,
    environment,
    expiresAt: over.expiresAt ?? null,
  });
  return { token: minted.token, record };
}

/**
 * ADM-6: the guard now reads the security policy's IP allowlist. Empty = from anywhere,
 * which is what it has always meant and what every existing test assumes.
 */
const openPolicy = (ipAllowlist: string[] = []) =>
  ({ get: async () => ({ ipAllowlist, idleTimeoutMinutes: 15, require2fa: true }) }) as never;

describe('ApiKeyGuard (H-30)', () => {
  let repo: InMemoryApiKeyRepository;
  let guard: ApiKeyGuard;

  beforeEach(() => {
    repo = new InMemoryApiKeyRepository();
    // ADM-5: the guard reads the environment it is running in — a test key is not a
    // production credential.
    guard = new ApiKeyGuard(repo, new Reflector(), { isProduction: false } as never, openPolicy());
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

/*
 * ADM-5. A partner credential with no end outlives the integration it was minted for, the
 * person who asked for it, and the laptop it was pasted into. And a TEST key — prefixed
 * `hm_test_…`, labelled STAGING in the console — was accepted against production data
 * exactly like a live one, so a credential handed out for a sandbox, with the care that
 * implies, was a production credential the whole time.
 */
describe('ApiKeyGuard · expiry and environment (ADM-5)', () => {
  const ctx = (token: string) => contextWith({ 'x-api-key': token });

  it('refuses a key whose day has passed', async () => {
    const repo = new InMemoryApiKeyRepository();
    const guard = new ApiKeyGuard(repo, new Reflector(), { isProduction: false } as never, openPolicy());
    const { token } = await seedKey(repo, [], { expiresAt: new Date('2020-01-01') });

    await expect(guard.canActivate(ctx(token))).rejects.toThrow(/expired/i);
  });

  it('admits one whose day has not', async () => {
    const repo = new InMemoryApiKeyRepository();
    const guard = new ApiKeyGuard(repo, new Reflector(), { isProduction: false } as never, openPolicy());
    const { token } = await seedKey(repo, [], { expiresAt: new Date('2099-01-01') });

    await expect(guard.canActivate(ctx(token))).resolves.toBe(true);
  });

  // Keys minted before the column existed have no date, and are left working: silently
  // expiring a partner's live credential on deploy is an outage, not a fix.
  it('admits a key that predates expiries at all', async () => {
    const repo = new InMemoryApiKeyRepository();
    const guard = new ApiKeyGuard(repo, new Reflector(), { isProduction: false } as never, openPolicy());
    const { token } = await seedKey(repo, [], { expiresAt: null });

    await expect(guard.canActivate(ctx(token))).resolves.toBe(true);
  });

  it('refuses a STAGING key against production, and admits it off production', async () => {
    const repo = new InMemoryApiKeyRepository();
    const { token } = await seedKey(repo, [], { environment: ApiKeyEnvironment.STAGING });

    const inProd = new ApiKeyGuard(repo, new Reflector(), { isProduction: true } as never, openPolicy());
    await expect(inProd.canActivate(ctx(token))).rejects.toThrow(/production/i);

    const inStaging = new ApiKeyGuard(repo, new Reflector(), { isProduction: false } as never, openPolicy());
    await expect(inStaging.canActivate(ctx(token))).resolves.toBe(true);
  });

  it('still admits a live key in production', async () => {
    const repo = new InMemoryApiKeyRepository();
    const guard = new ApiKeyGuard(repo, new Reflector(), { isProduction: true } as never, openPolicy());
    const { token } = await seedKey(repo, []);

    await expect(guard.canActivate(ctx(token))).resolves.toBe(true);
  });
});

/*
 * ADM-6: the allowlist is read by the one surface admin-service owns end to end — its own
 * partner keys, its own policy. Not the HQ console: those requests arrive through the
 * gateway, which this service cannot see past, and pretending otherwise would be a second
 * lie of the same kind.
 */
describe('ApiKeyGuard · IP allowlist (ADM-6)', () => {
  const from = (ip: string, token: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-api-key': token },
          socket: { remoteAddress: ip },
        }),
      }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as never;

  it('admits a partner inside the allowlist and refuses one outside it', async () => {
    const repo = new InMemoryApiKeyRepository();
    const { token } = await seedKey(repo, []);
    const guard = new ApiKeyGuard(
      repo,
      new Reflector(),
      { isProduction: false } as never,
      openPolicy(['203.0.113.0/24']),
    );

    await expect(guard.canActivate(from('203.0.113.9', token))).resolves.toBe(true);
    await expect(guard.canActivate(from('198.51.100.4', token))).rejects.toThrow(/address/i);
  });

  it('still admits everyone while the list is empty', async () => {
    const repo = new InMemoryApiKeyRepository();
    const { token } = await seedKey(repo, []);
    const guard = new ApiKeyGuard(
      repo,
      new Reflector(),
      { isProduction: false } as never,
      openPolicy(),
    );

    await expect(guard.canActivate(from('198.51.100.4', token))).resolves.toBe(true);
  });
});
