import { ServiceUnavailableException } from '@nestjs/common';

import { Role } from '../domain/role.enum';
import {
  configureDepotScope,
  depotScopeStatus,
  httpDepotScopeResolver,
  resetDepotScope,
  resolveDepotScope,
} from './depot-scope-resolver';

const CFG = { depotServiceUrl: 'http://depot:3007', internalKey: 'k' };

describe('resolveDepotScope', () => {
  afterEach(() => {
    resetDepotScope();
    jest.restoreAllMocks();
  });

  // Unconfigured is a WIRING mistake, not an outage — the caller falls back to the
  // token's own depot. Throwing here would 503 every isolated service test instead.
  it('returns null and warns once when bootstrap never configured it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await resolveDepotScope('s1', Role.SUPERVISOR)).toBeNull();
    expect(await resolveDepotScope('s2', Role.SUPERVISOR)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('caches a resolved set for the TTL, then resolves again', async () => {
    const resolve = jest.fn().mockResolvedValue(['d1', 'd2']);
    configureDepotScope(resolve, { ttlMs: 20 });

    expect(await resolveDepotScope('spv', Role.SUPERVISOR)).toEqual(['d1', 'd2']);
    await resolveDepotScope('spv', Role.SUPERVISOR);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(depotScopeStatus()).toEqual({ configured: true, cached: 1 });

    await new Promise((r) => setTimeout(r, 30));
    await resolveDepotScope('spv', Role.SUPERVISOR);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  /**
   * Stale-on-error is the one concession to availability: while refreshing fails, an
   * answer already verified keeps serving. The system never INVENTS access, it only
   * re-serves access it confirmed — and `staleUntil` is not extended, so a long
   * outage still expires it.
   */
  it('re-serves the last confirmed set while refreshing fails', async () => {
    let fail = false;
    configureDepotScope(
      async () => {
        if (fail) throw new Error('depot-service down');
        return ['d1'];
      },
      { ttlMs: 1, staleOnErrorMs: 10_000 },
    );
    expect(await resolveDepotScope('spv', Role.SUPERVISOR)).toEqual(['d1']);
    await new Promise((r) => setTimeout(r, 5));
    fail = true;
    expect(await resolveDepotScope('spv', Role.SUPERVISOR)).toEqual(['d1']);
  });

  it('fails CLOSED once the stale window has passed', async () => {
    let fail = false;
    configureDepotScope(
      async () => {
        if (fail) throw new Error('down');
        return ['d1'];
      },
      { ttlMs: 1, staleOnErrorMs: 1 },
    );
    await resolveDepotScope('spv', Role.SUPERVISOR);
    await new Promise((r) => setTimeout(r, 10));
    fail = true;
    await expect(resolveDepotScope('spv', Role.SUPERVISOR)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails closed for an account it has never resolved', async () => {
    configureDepotScope(async () => {
      throw new Error('down');
    });
    await expect(resolveDepotScope('new', Role.MANAGER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('passes a ServiceUnavailableException through unchanged', async () => {
    const own = new ServiceUnavailableException('Depot scope lookup is not configured.');
    configureDepotScope(async () => {
      throw own;
    });
    await expect(resolveDepotScope('x', Role.MANAGER)).rejects.toBe(own);
  });

  it('drops the cache when reconfigured, so a redeploy cannot serve a stale map', async () => {
    configureDepotScope(async () => ['d1']);
    await resolveDepotScope('spv', Role.SUPERVISOR);
    expect(depotScopeStatus().cached).toBe(1);
    configureDepotScope(async () => ['d9']);
    expect(depotScopeStatus().cached).toBe(0);
    expect(await resolveDepotScope('spv', Role.SUPERVISOR)).toEqual(['d9']);
  });
});

describe('httpDepotScopeResolver', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('asks depot-service for the set, with the role and the internal key', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ depotIds: ['d1', 'd2'] }) });
    expect(await httpDepotScopeResolver(CFG)('spv-1', Role.SUPERVISOR)).toEqual(['d1', 'd2']);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://depot:3007/api/v1/staff-hierarchy/internal/scope/spv-1?role=SUPERVISOR');
    expect(init.headers['x-internal-key']).toBe('k');
  });

  it.each([
    ['no url', { internalKey: 'k' }],
    ['no key', { depotServiceUrl: 'http://depot:3007' }],
  ])('fails closed when configured with %s', async (_c, cfg) => {
    await expect(httpDepotScopeResolver(cfg)('s', Role.MANAGER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(httpDepotScopeResolver(CFG)('s', Role.MANAGER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails closed when the connection itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(httpDepotScopeResolver(CFG)('s', Role.MANAGER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // A malformed body is "sees nothing", never "sees everything": a wildcard here
  // would be a tenant-isolation breach.
  it.each([
    ['a missing depotIds', {}],
    ['a non-array depotIds', { depotIds: 'd1' }],
  ])('returns an empty set for %s', async (_case, body) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });
    expect(await httpDepotScopeResolver(CFG)('s', Role.MANAGER)).toEqual([]);
  });

  it('filters non-string members out of the list', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ depotIds: ['d1', 7, null] }) });
    expect(await httpDepotScopeResolver(CFG)('s', Role.MANAGER)).toEqual(['d1']);
  });
});
