import { CrmConfigService } from '../../src/config/crm-config.service';
import { SegmentUnavailableError } from '../../src/domain/errors';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, query-string segment, authorization
// header, res.ok branch, fail-CLOSED catch, response parsing) against a mocked global.fetch —
// the unit the e2e's Fake* stand-ins never run. No network, no DB.

function makeConfig(over: Partial<Record<string, unknown>> = {}): CrmConfigService {
  return {
    customerServiceUrl: 'http://customer:3002',
    ...over,
  } as unknown as CrmConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown; throwJson?: boolean }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => {
      if (init.throwJson) throw new Error('bad json');
      return init.body ?? {};
    },
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const AUTH = 'Bearer staff-token';

describe('CustomerDirectoryHttpAdapter', () => {
  it('fails closed when customer-service url is not configured', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig({ customerServiceUrl: '' })).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the caller token is missing', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, ''),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the audience (no filter -> no query string) forwarding the bearer token', async () => {
    const recipients = [{ customerId: 'c1', name: 'Ani', phone: '0811' }];
    fetchMock.mockResolvedValue(res({ body: recipients }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH);
    expect(out).toEqual(recipients);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: AUTH }) }),
    );
  });

  it('builds the tier + city segment query string', async () => {
    fetchMock.mockResolvedValue(res({ body: [] }));
    await new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment(
      { tier: 'GOLD', city: 'Jakarta Selatan' },
      AUTH,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory?tier=GOLD&city=Jakarta+Selatan',
      expect.anything(),
    );
  });

  it('fails closed on non-2xx (never sends to a silently-empty audience)', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });

  it('fails closed when customer-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });
});
