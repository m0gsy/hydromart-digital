import { DepotConfigService } from '../../src/config/depot-config.service';
import { LowStockAlert } from '../../src/application/ports/low-stock-alert.port';
import { LowStockAlertHttpAdapter } from '../../src/infrastructure/http/low-stock-alert.http.adapter';

// Exercises the REAL HTTP adapter code (skip branches, URL/header/body building, res.ok
// branch, fail-open catch) against a mocked global.fetch — the unit the e2e's Fake* stand-in
// never runs. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): DepotConfigService {
  return {
    crmServiceUrl: 'http://crm:3012',
    alertPhone: '628123456789',
    internalServiceKey: KEY,
    ...over,
  } as unknown as DepotConfigService;
}

function res(init: { ok?: boolean; status?: number }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return { ok: init.ok ?? status < 400, status } as unknown as Response;
}

const alert = (): LowStockAlert => ({
  depotId: 'd1',
  depotName: 'Depot Pusat',
  label: 'Galon 19L',
  quantity: 3,
  minimum: 10,
});

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('LowStockAlertHttpAdapter', () => {
  it('skips (fail open) when alert phone is blank', async () => {
    await new LowStockAlertHttpAdapter(makeConfig({ alertPhone: '' })).emit(alert(), '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips (fail open) when crm-service url is blank', async () => {
    await new LowStockAlertHttpAdapter(makeConfig({ crmServiceUrl: '' })).emit(alert(), '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips (fail open) when no internal key', async () => {
    await new LowStockAlertHttpAdapter(makeConfig({ internalServiceKey: '' })).emit(alert(), '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts STOCK_LOW to crm internal notifications with x-internal-key on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), 'Bearer x');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://crm:3012/api/v1/notifications/internal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({
      event: 'STOCK_LOW',
      phone: '628123456789',
      vars: { depot: 'Depot Pusat', item: 'Galon 19L', quantity: '3', minimum: '10' },
    });
  });

  it('fails open (resolves) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), '')).resolves.toBeUndefined();
  });

  it('fails open (resolves) when crm-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), '')).resolves.toBeUndefined();
  });
});
