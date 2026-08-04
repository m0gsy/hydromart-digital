import { ServiceUnavailableException } from '@nestjs/common';

import { SupervisionHttpAdapter } from '../../src/infrastructure/http/supervision.http.adapter';

/**
 * The reporting line, read from and written to depot-service.
 *
 * The two halves fail differently on purpose: reading is fail-SOFT (its only caller is a
 * leave notification, and a missing notification must not reject somebody's leave), writing
 * RAISES (the CSV's `atasan` column is a request whose result the uploader expects to see).
 */
describe('SupervisionHttpAdapter', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const env = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
    process.env.DEPOT_SERVICE_URL = 'http://depot:3007/';
    process.env.INTERNAL_SERVICE_KEY = 'k';
  });
  afterEach(() => {
    process.env = { ...env };
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('reads the superior over the internal describe route', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ superiorId: 'boss-1', directDepotIds: [] })),
    );

    await expect(new SupervisionHttpAdapter().superiorOf('staff-1')).resolves.toBe('boss-1');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/v1/staff-hierarchy/internal/describe/staff-1',
    );
  });

  // Fail-soft: a leave request must not be rejected because depot-service blinked.
  it('answers null instead of raising when the lookup fails', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(new SupervisionHttpAdapter().superiorOf('staff-1')).resolves.toBeNull();
  });

  it('writes a link through the console route, so the cycle check applies', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    await new SupervisionHttpAdapter().setSuperior('staff-1', 'boss-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot:3007/api/v1/staff-hierarchy/staff-1/superior');
    expect(init.method).toBe('PUT');
    expect(init.headers['x-internal-key']).toBe('k');
    expect(JSON.parse(init.body)).toEqual({ superiorId: 'boss-1' });
  });

  it('raises on a write that is refused, unreachable, or unconfigured', async () => {
    const adapter = new SupervisionHttpAdapter();

    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(adapter.setSuperior('a', 'b')).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.setSuperior('a', 'b')).rejects.toThrow('tidak terjangkau');

    delete process.env.DEPOT_SERVICE_URL;
    await expect(adapter.setSuperior('a', 'b')).rejects.toThrow('DEPOT_SERVICE_URL');
  });
});
