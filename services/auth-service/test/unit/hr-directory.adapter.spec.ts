import { HrDirectoryHttpAdapter } from '../../src/infrastructure/http/hr-directory.http.adapter';

const INPUT = {
  authSubjectId: 'cust-1',
  fullName: 'Budi',
  phone: '+628110000001',
  role: 'KEPALA_DEPOT',
  depotId: 'depot-1',
  position: 'Kepala Depot',
  joinDate: '2026-08-04',
  employmentStatus: 'PERMANENT',
  salaryType: 'MONTHLY',
  monthlyRate: 5_000_000,
};

/**
 * The hr-service half of a staff invite. Every branch here is a way the call can fail, and
 * every one of them must RAISE: an account with no employee record is half a person, and
 * an invite that half-succeeded silently is exactly what this release exists to stop.
 */
describe('HrDirectoryHttpAdapter', () => {
  const configured = { hrDirectory: { hrUrl: 'http://hr:3018/', internalKey: 'k' } } as never;
  const blank = { hrDirectory: { hrUrl: '', internalKey: '' } } as never;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('fails closed when hr-service is not configured, without calling anything', async () => {
    const adapter = new HrDirectoryHttpAdapter(blank);
    await expect(adapter.provisionEmployee(INPUT)).rejects.toThrow('HR_SERVICE_URL');
    await expect(adapter.setEmployeeActive('cust-1', false)).rejects.toThrow('HR_SERVICE_URL');
    await expect(adapter.setEmployeeDepot('cust-1', 'depot-2')).rejects.toThrow('HR_SERVICE_URL');
    await expect(adapter.anonymiseEmployee('cust-1')).rejects.toThrow('HR_SERVICE_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the employee to the provision route, with the internal key and no trailing slash', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await new HrDirectoryHttpAdapter(configured).provisionEmployee(INPUT);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hr:3018/api/v1/employees/internal/provision');
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-key']).toBe('k');
    expect(JSON.parse(init.body)).toMatchObject({ authSubjectId: 'cust-1', role: 'KEPALA_DEPOT' });
  });

  it('carries a status change and a deletion to their own routes', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const adapter = new HrDirectoryHttpAdapter(configured);

    await adapter.setEmployeeActive('cust-1', false);
    expect(fetchMock.mock.calls[0][0]).toBe('http://hr:3018/api/v1/employees/internal/status');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      authSubjectId: 'cust-1',
      active: false,
    });

    await adapter.anonymiseEmployee('cust-1');
    expect(fetchMock.mock.calls[1][0]).toBe('http://hr:3018/api/v1/employees/internal/anonymise');
  });

  it('carries a depot transfer, including a null depot, to its own route', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const adapter = new HrDirectoryHttpAdapter(configured);

    await adapter.setEmployeeDepot('cust-1', 'depot-2');
    expect(fetchMock.mock.calls[0][0]).toBe('http://hr:3018/api/v1/employees/internal/depot');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      authSubjectId: 'cust-1',
      depotId: 'depot-2',
    });

    // A role above any single depot has none, and null must reach hr-service as null
    // rather than being dropped out of the JSON body.
    await adapter.setEmployeeDepot('cust-1', null);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      authSubjectId: 'cust-1',
      depotId: null,
    });
  });

  // K-4: the whole file in one call. The per-row verdicts are the reason this route exists
  // separately — the caller has already minted those accounts and must say which rows are
  // still missing their employee half.
  it('posts the whole file to the batch route and returns the per-row verdicts', async () => {
    const results = [
      { index: 0, ok: true, message: null },
      { index: 1, ok: false, message: 'NIK sudah dipakai karyawan lain' },
    ];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results }) });

    const adapter = new HrDirectoryHttpAdapter(configured);
    await expect(adapter.provisionEmployees([INPUT, INPUT])).resolves.toEqual(results);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://hr:3018/api/v1/employees/internal/provision-many');
    expect(JSON.parse(init.body).rows).toHaveLength(2);
  });

  it('does not call hr-service at all for an empty file', async () => {
    await expect(new HrDirectoryHttpAdapter(configured).provisionEmployees([])).resolves.toEqual(
      [],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A 200 carrying something else is not "every row provisioned". Reporting it as success
  // is how 500 rows get marked done while hr-service has none of them.
  it('refuses a batch answer it cannot read', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await expect(
      new HrDirectoryHttpAdapter(configured).provisionEmployees([INPUT]),
    ).rejects.toThrow('tidak dikenali');
  });

  it('raises on a refusal and on an unreachable service', async () => {
    const adapter = new HrDirectoryHttpAdapter(configured);

    fetchMock.mockResolvedValue({ ok: false, status: 422 });
    await expect(adapter.provisionEmployee(INPUT)).rejects.toThrow('422');

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.provisionEmployee(INPUT)).rejects.toThrow('tidak terjangkau');
  });
});

// The abort timer this adapter arms had never been let fire: a hung hr-service must make
// the invite FAIL rather than hold the request open for its whole life.
describe('HrDirectoryHttpAdapter when hr-service hangs', () => {
  const configured = { hrDirectory: { hrUrl: 'http://hr:3018/', internalKey: 'k' } } as never;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        }),
    ) as never;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('aborts and raises instead of hanging the invite', async () => {
    // The handler has to be attached before the timer fires, or the rejection lands unhandled.
    const settled = new HrDirectoryHttpAdapter(configured).provisionEmployee(INPUT).then(
      () => 'resolved',
      () => 'rejected',
    );
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await settled).toBe('rejected');
  });
});
