import {
  createPublicKey,
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom, of, throwError } from 'rxjs';

import { clientTracker, perClientThrottle } from '../http/per-client-throttle';
import { AuditMutationsInterceptor, type AuditMutationSink } from './audit-mutations.interceptor';
import type { AuditEvent } from './audit-trail';
import { CAPABILITY_KEY, ROLES_KEY, SELF_SCOPED_KEY } from './decorators';
import {
  EXTERNAL_ACCESS_KEY,
  ExternalAccess,
  ExternalKeyStore,
  MACHINE_ROLE,
  externalKeyStore,
  resetExternalKeyStores,
  tokenAlgorithm,
  verifiedExternalCaller,
  verifyExternalToken,
} from './external-access';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

// ---------------------------------------------------------------- fixtures

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;
const AUTH_URL = 'http://auth.test';
const JWKS_URL = `${AUTH_URL}/api/v1/auth/jwks`;

interface Pair {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function pair(kid: string): Pair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig' } };
}

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function tokenFor(
  key: Pair,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'ES256', kid: key.kid, typ: 'JWT' },
): string {
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = sign('sha256', Buffer.from(data), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}

const aiClaims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'hydromart-auth',
  aud: 'hydromart-ai',
  sub: 'user-1',
  role: 'MANAGER',
  depotId: 'depot-1',
  exp: NOW + 600,
  ...over,
});

const machineClaims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'hydromart-auth',
  aud: 'hydromart-machine',
  sub: 'n8n',
  scopes: ['franchiseRead', 42, 'priceDraftWrite'],
  exp: NOW + 600,
  ...over,
});

const KEY = pair('k1');
const OTHER = pair('k2');
const keysOf = (...pairs: Pair[]): ReadonlyMap<string, KeyObject> =>
  new Map(pairs.map((p) => [p.kid, createPublicKey({ key: p.jwk as JsonWebKey, format: 'jwk' })]));

const jwksResponse = (keys: unknown[], ok = true): Response =>
  ({ ok, json: async () => ({ keys }) }) as unknown as Response;

// ---------------------------------------------------------------- verifyExternalToken

describe('verifyExternalToken (HD-2)', () => {
  const keys = keysOf(KEY);

  it('accepts a token for a person acting through the AI web', () => {
    expect(verifyExternalToken(tokenFor(KEY, aiClaims()), keys, NOW_MS)).toEqual({
      sub: 'user-1',
      via: 'ai',
      role: 'MANAGER',
      depotId: 'depot-1',
      scopes: [],
    });
  });

  it('accepts a machine token and keeps only string scopes, with no role', () => {
    expect(verifyExternalToken(tokenFor(KEY, machineClaims()), keys, NOW_MS)).toEqual({
      sub: 'n8n',
      via: 'machine',
      role: null,
      depotId: null,
      scopes: ['franchiseRead', 'priceDraftWrite'],
    });
    const noScopes = machineClaims({ scopes: 'franchiseRead' });
    expect(verifyExternalToken(tokenFor(KEY, noScopes), keys, NOW_MS)?.scopes).toEqual([]);
  });

  it.each([
    ['an HS256 header', { alg: 'HS256', kid: 'k1' }],
    ['a header with no kid', { alg: 'ES256' }],
    ['a kid nobody published', { alg: 'ES256', kid: 'k2' }],
  ])('refuses %s', (_label, header) => {
    expect(verifyExternalToken(tokenFor(KEY, aiClaims(), header), keys, NOW_MS)).toBeNull();
  });

  it('refuses a signature made by another key, and a tampered payload', () => {
    expect(
      verifyExternalToken(tokenFor(OTHER, aiClaims(), { alg: 'ES256', kid: 'k1' }), keys, NOW_MS),
    ).toBeNull();
    const [head, , sig] = tokenFor(KEY, aiClaims()).split('.');
    const forged = `${head}.${b64(aiClaims({ role: 'SUPER_ADMIN' }))}.${sig}`;
    expect(verifyExternalToken(forged, keys, NOW_MS)).toBeNull();
  });

  it('refuses a DER or truncated signature', () => {
    const [head, body] = tokenFor(KEY, aiClaims()).split('.');
    expect(verifyExternalToken(`${head}.${body}.AAAA`, keys, NOW_MS)).toBeNull();
  });

  it.each([
    ['another issuer', { iss: 'someone-else' }],
    ['the platform audience', { aud: 'hydromart-api' }],
    ['two audiences at once', { aud: ['hydromart-ai', 'hydromart-machine'] }],
    ['an inherited property name as audience', { aud: '__proto__' }],
    ['an expired token', { exp: NOW - 1 }],
    ['a token with no expiry', { exp: undefined }],
    ['a token not valid yet', { nbf: NOW + 60 }],
    ['a non-numeric not-before', { nbf: 'soon' }],
    ['no subject', { sub: '' }],
    ['an AI token with no role', { role: undefined }],
  ])('refuses %s', (_label, over) => {
    expect(verifyExternalToken(tokenFor(KEY, aiClaims(over)), keys, NOW_MS)).toBeNull();
  });

  it('accepts a not-before already passed, and treats a non-string depot as none', () => {
    const claims = verifyExternalToken(
      tokenFor(KEY, aiClaims({ nbf: NOW - 5, depotId: 7 })),
      keys,
      NOW_MS,
    );
    expect(claims).toMatchObject({ via: 'ai', depotId: null });
  });

  it('refuses anything that is not three base64url JSON objects', () => {
    expect(verifyExternalToken('a.b', keys, NOW_MS)).toBeNull();
    expect(verifyExternalToken('!!.@@.##', keys, NOW_MS)).toBeNull();
    expect(verifyExternalToken(`${b64([1])}.${b64(aiClaims())}.x`, keys, NOW_MS)).toBeNull();
  });

  it('defaults the clock to now', () => {
    const live = tokenFor(KEY, aiClaims({ exp: Math.floor(Date.now() / 1000) + 60 }));
    expect(verifyExternalToken(live, keys)?.sub).toBe('user-1');
  });
});

describe('tokenAlgorithm', () => {
  it('reads the claimed alg and nothing else', () => {
    expect(tokenAlgorithm(tokenFor(KEY, aiClaims()))).toBe('ES256');
    expect(tokenAlgorithm(`${b64({ typ: 'JWT' })}.x.y`)).toBeNull();
    expect(tokenAlgorithm('not-a-token')).toBeNull();
    expect(tokenAlgorithm('')).toBeNull();
  });
});

describe('ExternalAccess', () => {
  it('records which external callers a route admits', () => {
    class Ctl {
      route(): void {}
    }
    ExternalAccess('ai', 'machine')(Ctl);
    expect(Reflect.getMetadata(EXTERNAL_ACCESS_KEY, Ctl)).toEqual(['ai', 'machine']);
  });
});

// ---------------------------------------------------------------- the key store

describe('ExternalKeyStore: the kill switch', () => {
  let now = NOW_MS;
  const clock = (): number => now;
  beforeEach(() => {
    now = NOW_MS;
  });

  it('holds nothing until it has read the set, then holds the signing keys only', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jwksResponse([
          KEY.jwk,
          { ...OTHER.jwk, use: 'enc' },
          { ...OTHER.jwk, kid: undefined },
          { ...OTHER.jwk, crv: 'P-384' },
          { kty: 'RSA', kid: 'r1' },
          { kty: 'EC', crv: 'P-256', kid: 'broken', x: 'AA', y: 'AA' },
          null,
        ]),
      );
    const store = new ExternalKeyStore(JWKS_URL, { fetchImpl, now: clock });
    expect(store.current().size).toBe(0);
    await store.refresh();
    expect([...store.current().keys()]).toEqual(['k1']);
    expect(fetchImpl).toHaveBeenCalledWith(
      JWKS_URL,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('drops every key within one refresh once auth-service publishes an empty set', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jwksResponse([KEY.jwk]))
      .mockResolvedValueOnce(jwksResponse([]));
    const store = new ExternalKeyStore(JWKS_URL, { fetchImpl, now: clock });
    await store.refresh();
    now += 10_000;
    await store.refresh(); // within the 30 s interval: not re-read
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 25_000;
    await store.refresh();
    expect(store.current().size).toBe(0);
  });

  it('keeps an unreadable set for 60 seconds, then trusts nothing', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jwksResponse([KEY.jwk]))
      .mockResolvedValueOnce(jwksResponse([], false))
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const store = new ExternalKeyStore(JWKS_URL, { fetchImpl, now: clock });
    await store.refresh();
    now += 31_000;
    await store.refresh(); // 503 from auth-service
    expect(store.current().size).toBe(1);
    now += 6_000;
    await store.refresh(); // unreachable
    expect(store.current().size).toBe(1);
    now += 30_000; // 67 s after the last good read
    expect(store.current().size).toBe(0);
  });

  it('shares one request between concurrent callers and waits 5 s after a failure', async () => {
    let release: (r: Response) => void = () => {};
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (release = r)))
      .mockRejectedValue(new Error('down'));
    const store = new ExternalKeyStore(JWKS_URL, { fetchImpl, now: clock });
    const both = Promise.all([store.refresh(), store.refresh()]);
    release(jwksResponse([KEY.jwk]));
    await both;
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 31_000;
    await store.refresh(); // fails
    now += 1_000;
    await store.refresh(); // too soon to retry
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reads a body with no key list as an empty set', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => null });
    const store = new ExternalKeyStore(JWKS_URL, { fetchImpl, now: clock });
    await store.refresh();
    expect(store.current().size).toBe(0);
  });

  it('defaults to the global fetch and clock', () => {
    expect(new ExternalKeyStore(JWKS_URL).current().size).toBe(0);
  });
});

describe('externalKeyStore registry', () => {
  afterEach(() => resetExternalKeyStores());

  it('is one store per address, and none without one', () => {
    expect(externalKeyStore(undefined)).toBeNull();
    const a = externalKeyStore(`${AUTH_URL}/`);
    expect(a?.url).toBe(JWKS_URL);
    expect(externalKeyStore(AUTH_URL)).toBe(a);
    resetExternalKeyStores();
    expect(externalKeyStore(AUTH_URL)).not.toBe(a);
  });
});

// ---------------------------------------------------------------- callers of the store

/** Serves KEY's JWKS from AUTH_URL through the global fetch and warms the shared store. */
async function warmStore(keys: unknown[] = [KEY.jwk]): Promise<jest.SpyInstance> {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue(jwksResponse(keys));
  await externalKeyStore(AUTH_URL)!.refresh();
  return spy;
}

const liveAi = (over: Record<string, unknown> = {}): string =>
  tokenFor(KEY, aiClaims({ exp: Math.floor(Date.now() / 1000) + 600, ...over }));
const liveMachine = (over: Record<string, unknown> = {}): string =>
  tokenFor(KEY, machineClaims({ exp: Math.floor(Date.now() / 1000) + 600, ...over }));

describe('verifiedExternalCaller', () => {
  afterEach(() => {
    resetExternalKeyStores();
    jest.restoreAllMocks();
  });

  it('names the verified account behind a Bearer header or a bare token', async () => {
    await warmStore();
    expect(verifiedExternalCaller(`Bearer ${liveAi()}`, AUTH_URL)?.sub).toBe('user-1');
    // The guard takes the scheme in any case, so the rate-limit key must too.
    expect(verifiedExternalCaller(`bearer ${liveAi()}`, AUTH_URL)?.sub).toBe('user-1');
    expect(verifiedExternalCaller(`BEARER  ${liveAi()}`, AUTH_URL)?.sub).toBe('user-1');
    expect(verifiedExternalCaller(liveMachine(), AUTH_URL)?.via).toBe('machine');
  });

  it('is null for no credential, another algorithm, or no auth-service address', async () => {
    await warmStore();
    expect(verifiedExternalCaller(undefined, AUTH_URL)).toBeNull();
    expect(verifiedExternalCaller(`Bearer ${b64({ alg: 'HS256' })}.x.y`, AUTH_URL)).toBeNull();
    expect(verifiedExternalCaller(liveAi(), undefined)).toBeNull();
  });
});

describe('clientTracker (per account, HD-2)', () => {
  afterEach(() => {
    resetExternalKeyStores();
    jest.restoreAllMocks();
  });

  const req = (authorization?: string): Record<string, unknown> => ({
    headers: authorization ? { authorization } : {},
    socket: { remoteAddress: '203.0.113.9' },
  });

  it('counts a verified AI-web or machine token per account', async () => {
    await warmStore();
    const env = { AUTH_SERVICE_URL: AUTH_URL };
    expect(clientTracker(req(`Bearer ${liveAi()}`), env)).toBe('a:user-1');
    expect(clientTracker(req(`Bearer ${liveMachine()}`), env)).toBe('a:n8n');
  });

  it('keeps the address for anything it cannot verify', async () => {
    await warmStore([]);
    const env = { AUTH_SERVICE_URL: AUTH_URL };
    expect(clientTracker(req(`Bearer ${liveAi()}`), env)).toBe('203.0.113.9');
    expect(clientTracker(req(), env)).toBe('203.0.113.9');
    expect(clientTracker(req(`Bearer ${liveAi()}`))).toBe('203.0.113.9');
  });

  it('is the tracker every service gets from perClientThrottle', () => {
    const { getTracker } = perClientThrottle([{ ttl: 60_000, limit: 10 }]);
    expect(getTracker(req())).toBe('203.0.113.9');
  });
});

// ---------------------------------------------------------------- the guards

function ctxFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Cls {},
  } as unknown as ExecutionContext;
}

const reflectorReturning = (values: Record<string, unknown>): Reflector =>
  ({
    getAllAndOverride: (key: string) => values[key],
    get: (key: string) => values[key],
  }) as unknown as Reflector;

describe('JwtAuthGuard with an ES256 token (HD-2)', () => {
  const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
  const config = (url?: string): ConfigService =>
    ({ get: () => url, getOrThrow: () => 'hs-secret' }) as unknown as ConfigService;
  const guard = (
    route: Record<string, unknown>,
    url: string | undefined = AUTH_URL,
  ): JwtAuthGuard => new JwtAuthGuard(reflectorReturning(route), jwt, config(url));

  afterEach(() => {
    resetExternalKeyStores();
    jest.restoreAllMocks();
  });

  it('admits a person through the AI web where the route allows it, as that person', async () => {
    await warmStore();
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${liveAi()}` } };
    await expect(
      guard({ [EXTERNAL_ACCESS_KEY]: ['ai'] }).canActivate(ctxFor(request)),
    ).resolves.toBe(true);
    expect(request.user).toEqual({
      sub: 'user-1',
      role: 'MANAGER',
      phone: null,
      depotId: 'depot-1',
      via: 'ai',
    });
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('admits a machine account with its scopes and no role of its own', async () => {
    await warmStore();
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${liveMachine()}` },
    };
    await guard({ [EXTERNAL_ACCESS_KEY]: ['ai', 'machine'] }).canActivate(ctxFor(request));
    expect(request.user).toMatchObject({
      sub: 'n8n',
      role: MACHINE_ROLE,
      via: 'machine',
      scopes: ['franchiseRead', 'priceDraftWrite'],
    });
  });

  it('answers 403 to a good token on a route not open to that caller', async () => {
    await warmStore();
    const ai = { headers: { authorization: `Bearer ${liveAi()}` } };
    await expect(guard({}).canActivate(ctxFor(ai))).rejects.toBeInstanceOf(ForbiddenException);
    const machine = { headers: { authorization: `Bearer ${liveMachine()}` } };
    await expect(
      guard({ [EXTERNAL_ACCESS_KEY]: ['ai'] }).canActivate(ctxFor(machine)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 401 to a token it cannot verify, or with no auth-service to ask', async () => {
    await warmStore([OTHER.jwk]);
    const request = { headers: { authorization: `Bearer ${liveAi()}` } };
    const open = { [EXTERNAL_ACCESS_KEY]: ['ai'] };
    await expect(guard(open).canActivate(ctxFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard(open, undefined).canActivate(ctxFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('RolesGuard with a machine account (HD-2)', () => {
  const machine = (scopes: string[]): Record<string, unknown> => ({
    user: { sub: 'n8n', role: MACHINE_ROLE, phone: null, via: 'machine', scopes },
  });
  const check = (route: Record<string, unknown>, request: Record<string, unknown>): boolean =>
    new RolesGuard(reflectorReturning(route)).canActivate(ctxFor(request));

  it('allows exactly the capabilities its token lists', () => {
    expect(check({ [CAPABILITY_KEY]: 'franchiseRead' }, machine(['franchiseRead']))).toBe(true);
    expect(() => check({ [CAPABILITY_KEY]: 'payoutWrite' }, machine(['franchiseRead']))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      check(
        { [CAPABILITY_KEY]: 'franchiseRead' },
        { user: { via: 'machine', role: MACHINE_ROLE } },
      ),
    ).toThrow(ForbiddenException);
  });

  it('is never admitted by a role list or a self-scoped route', () => {
    expect(() => check({ [ROLES_KEY]: [MACHINE_ROLE] }, machine(['franchiseRead']))).toThrow(
      ForbiddenException,
    );
    expect(() => check({ [SELF_SCOPED_KEY]: true }, machine(['franchiseRead']))).toThrow(
      ForbiddenException,
    );
  });

  it('leaves a person acting through the AI web to the ordinary rules', () => {
    const person = { user: { sub: 'u', role: 'SUPER_ADMIN', phone: null, via: 'ai' } };
    expect(check({ [CAPABILITY_KEY]: 'franchiseRead' }, person)).toBe(true);
  });
});

// ---------------------------------------------------------------- the audit trail

describe('AuditMutationsInterceptor for an external caller (HD-2)', () => {
  const ctx = (req: Record<string, unknown>): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
  const externalPost = (headers: Record<string, unknown> = {}): Record<string, unknown> => ({
    method: 'POST',
    originalUrl: '/api/v1/price-proposals',
    body: { price: 18000 },
    headers,
    user: { sub: 'n8n', via: 'machine' },
  });

  /** A sink that tells the two writes apart: `strict` holds what went through recordOrThrow. */
  const recordingSink = () => {
    const strict: AuditEvent[] = [];
    const plain: AuditEvent[] = [];
    const sink: AuditMutationSink = {
      record: async (e) => void plain.push(e),
      recordOrThrow: async (e) => void strict.push(e),
    };
    return { sink, strict, plain };
  };

  it('records the change before it runs, with the account type, workflow and proposal', async () => {
    const { sink, strict, plain } = recordingSink();
    const run = jest.fn(() => of('done'));
    const out = new AuditMutationsInterceptor(sink).intercept(
      ctx(externalPost({ 'x-workflow': ' daily-price ', 'x-ai-proposal': 'P-17', 'x-ai-suggestion-id': 'S-9', 'x-other': 'x' })),
      { handle: run } as CallHandler,
    );
    await expect(firstValueFrom(out)).resolves.toBe('done');
    // The row the change depends on goes through the write that can fail; the outcome row
    // after it is fail-open like every other.
    expect(strict.map((e) => e.action)).toEqual(['price-proposals.created.requested']);
    expect(plain.map((e) => e.action)).toEqual(['price-proposals.created']);
    expect(strict[0].metadata).toMatchObject({
      via: 'machine',
      workflow: 'daily-price',
      proposalId: 'P-17',
      suggestionId: 'S-9',
      price: 18000,
    });
  });

  it('refuses the change, without running it, when the record cannot be made', async () => {
    // Like both real sinks, `record` swallows a failed write. The refusal must not depend on
    // it: only recordOrThrow decides, and that one rejects.
    const sink: AuditMutationSink = {
      record: jest.fn().mockResolvedValue(undefined),
      recordOrThrow: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const run = jest.fn(() => of('done'));
    const out = new AuditMutationsInterceptor(sink).intercept(ctx(externalPost()), {
      handle: run,
    } as CallHandler);
    await expect(firstValueFrom(out)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(run).not.toHaveBeenCalled();
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('refuses it when this service has no audit sink at all', async () => {
    const run = jest.fn(() => of('done'));
    const out = new AuditMutationsInterceptor().intercept(ctx(externalPost()), {
      handle: run,
    } as CallHandler);
    await expect(firstValueFrom(out)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes the handler's own error through, recorded as a failure", async () => {
    const { sink, strict, plain } = recordingSink();
    const out = new AuditMutationsInterceptor(sink).intercept(
      ctx(externalPost({ 'x-workflow': '   ', 'x-ai-proposal': 'P'.repeat(300) })),
      { handle: () => throwError(() => new ForbiddenException('no')) } as CallHandler,
    );
    await expect(firstValueFrom(out)).rejects.toBeInstanceOf(ForbiddenException);
    await new Promise((r) => setImmediate(r));
    expect(plain[0]).toMatchObject({ success: false });
    expect(strict[0].metadata).toMatchObject({ workflow: null });
    expect(String(strict[0].metadata?.proposalId)).toHaveLength(120);
  });

  it('lets an external read through with no record', async () => {
    const sink: AuditMutationSink = { record: jest.fn(), recordOrThrow: jest.fn() };
    const out = new AuditMutationsInterceptor(sink).intercept(
      ctx({ ...externalPost(), method: 'GET' }),
      { handle: () => of('read') } as CallHandler,
    );
    await expect(firstValueFrom(out)).resolves.toBe('read');
    expect(sink.record).not.toHaveBeenCalled();
    expect(sink.recordOrThrow).not.toHaveBeenCalled();
  });
});
