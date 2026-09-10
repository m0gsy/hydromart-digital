import { ServiceUnavailableException } from '@nestjs/common';

import { SupervisionHttpAdapter } from '../../src/infrastructure/http/supervision.http.adapter';
import { HrConfigService } from '../../src/config/hr-config.service';

/**
 * The adapter reads its URL through the config service now, not off `process.env` at
 * field-initialisation time — `check-endpoint-contracts` can only resolve
 * `this.config.get(...)`. The two legacy fields are left as they were on purpose, so this
 * stand-in answers from the same env vars the test already sets.
 */
const config = () =>
  ({
    get depotService() {
      return {
        url: process.env.DEPOT_SERVICE_URL ?? '',
        internalKey: process.env.INTERNAL_SERVICE_KEY ?? '',
      };
    },
  }) as HrConfigService;

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

    await expect(new SupervisionHttpAdapter(config()).superiorOf('staff-1')).resolves.toBe(
      'boss-1',
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/v1/staff-hierarchy/internal/describe/staff-1',
    );
  });

  // Fail-soft: a leave request must not be rejected because depot-service blinked.
  it('answers null instead of raising when the lookup fails', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(new SupervisionHttpAdapter(config()).superiorOf('staff-1')).resolves.toBeNull();
  });

  it('writes a link through the console route, so the cycle check applies', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    await new SupervisionHttpAdapter(config()).setSuperior('staff-1', 'boss-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot:3007/api/v1/staff-hierarchy/staff-1/superior');
    expect(init.method).toBe('PUT');
    expect(init.headers['x-internal-key']).toBe('k');
    expect(JSON.parse(init.body)).toEqual({ superiorId: 'boss-1' });
  });

  it('raises on a write that is refused, unreachable, or unconfigured', async () => {
    const adapter = new SupervisionHttpAdapter(config());

    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(adapter.setSuperior('a', 'b')).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.setSuperior('a', 'b')).rejects.toThrow('tidak terjangkau');

    delete process.env.DEPOT_SERVICE_URL;
    await expect(adapter.setSuperior('a', 'b')).rejects.toThrow('DEPOT_SERVICE_URL');
  });

  /*
   * The kasbon half RAISES where the superior read swallows, and the difference is what is
   * at stake: a lookup that failed is not the same answer as "this depot has no assistant",
   * and treating it as one would hand the approval to anyone whose scope reaches the depot,
   * exactly when the system is least able to say who holds it. Money fails CLOSED.
   */
  it('reads the depot assistant, and raises rather than answering nobody', async () => {
    const adapter = new SupervisionHttpAdapter(config());

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ assistantSupervisorId: 'asv-1' })));
    await expect(adapter.assistantOfDepot('d-1')).resolves.toBe('asv-1');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://depot:3007/api/v1/depots/internal/d-1/assistant',
    );

    // A depot that genuinely has none is a real answer, and it is null, not a throw.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ assistantSupervisorId: null })));
    await expect(adapter.assistantOfDepot('d-1')).resolves.toBeNull();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({})));
    await expect(adapter.assistantOfDepot('d-1')).resolves.toBeNull();

    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(adapter.assistantOfDepot('d-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.assistantOfDepot('d-1')).rejects.toThrow('tidak terjangkau');

    fetchMock.mockRejectedValue('boom');
    await expect(adapter.assistantOfDepot('d-1')).rejects.toThrow('unknown');

    delete process.env.DEPOT_SERVICE_URL;
    await expect(adapter.assistantOfDepot('d-1')).rejects.toThrow('DEPOT_SERVICE_URL');
  });

  // undici rejects with things that are not Errors. Reading `.message` off one of those
  // throws inside the catch, which turns a fail-soft read into a 500.
  it('handles a rejection that is not an Error, in both directions', async () => {
    const adapter = new SupervisionHttpAdapter(config());

    fetchMock.mockRejectedValue('boom');
    await expect(adapter.superiorOf('staff-1')).resolves.toBeNull();
    await expect(adapter.setSuperior('a', 'b')).rejects.toThrow('unknown');
  });
});
