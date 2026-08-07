import { ServiceUnavailableException } from '@nestjs/common';

import { httpSuperiorResolver } from './superior-resolver';

describe('httpSuperiorResolver', () => {
  const cfg = { depotServiceUrl: 'http://depot:3007', internalKey: 'k' };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads the superior from the supervision table', async () => {
    global.fetch = jest.fn(async (url, init) => {
      expect(String(url)).toBe('http://depot:3007/api/v1/staff-hierarchy/internal/describe/staff-1');
      expect((init as RequestInit).headers).toMatchObject({ 'x-internal-key': 'k' });
      return new Response(JSON.stringify({ superiorId: 'boss-1', directDepotIds: [] }));
    }) as typeof fetch;

    await expect(httpSuperiorResolver(cfg)('staff-1')).resolves.toBe('boss-1');
  });

  // Nobody recorded is a legitimate answer, not an error: most staff have no superior yet.
  it('returns null when no superior is recorded', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ superiorId: null }))) as typeof fetch;

    await expect(httpSuperiorResolver(cfg)('staff-1')).resolves.toBeNull();
  });

  it('raises when unconfigured, refused, or unreachable', async () => {
    await expect(httpSuperiorResolver({})('staff-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    global.fetch = jest.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(httpSuperiorResolver(cfg)('staff-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await expect(httpSuperiorResolver(cfg)('staff-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
