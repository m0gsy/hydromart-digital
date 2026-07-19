import { HealthProbeHttpAdapter } from '../../src/infrastructure/http/health-probe.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, res.ok branch, catch → 'down')
// against a mocked global.fetch — the units the e2e's Fake* stand-ins never run. No
// network. The adapter takes a baseUrl directly (no config/internal key).

function res(init: { ok?: boolean; status?: number }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return { ok: init.ok ?? status < 400, status } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('HealthProbeHttpAdapter', () => {
  it("reports 'up' with httpStatus on a 2xx health response", async () => {
    fetchMock.mockResolvedValue(res({ ok: true, status: 200 }));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('up');
    expect(out.httpStatus).toBe(200);
    expect(typeof out.latencyMs).toBe('number');
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('hits GET /api/v1/health with an abort timeout signal', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3005/api/v1/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports 'down' (never faked up) on a non-2xx response, keeping httpStatus", async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('down');
    expect(out.httpStatus).toBe(503);
  });

  it("reports 'down' with null httpStatus when the peer is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('down');
    expect(out.httpStatus).toBeNull();
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports 'down' with null httpStatus on a timeout abort", async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('down');
    expect(out.httpStatus).toBeNull();
  });
});
