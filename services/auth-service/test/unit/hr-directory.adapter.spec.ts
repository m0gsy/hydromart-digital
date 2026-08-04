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

  it('raises on a refusal and on an unreachable service', async () => {
    const adapter = new HrDirectoryHttpAdapter(configured);

    fetchMock.mockResolvedValue({ ok: false, status: 422 });
    await expect(adapter.provisionEmployee(INPUT)).rejects.toThrow('422');

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter.provisionEmployee(INPUT)).rejects.toThrow('tidak terjangkau');
  });
});
