import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../../src/application/ports/notification.port';
import { HrConfigService } from '../../src/config/hr-config.service';
import { NotificationHttpAdapter } from '../../src/infrastructure/http/notification.http.adapter';

// Exercises the REAL adapter against a mocked global.fetch. Every path must RESOLVE:
// an HR decision (leave approval) may never fail because a notification did.

function makeConfig(url = 'http://crm:3012', internalKey = 'k-secret'): HrConfigService {
  return { crmService: { url, internalKey } } as unknown as HrConfigService;
}

const VARS = { name: 'Budi', type: 'ANNUAL', from: '2026-08-01', to: '2026-08-03' };
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('NotificationHttpAdapter.notify', () => {
  it('implements the port the module binds', () => {
    const port: NotificationPort = new NotificationHttpAdapter(makeConfig());
    expect(typeof port.notify).toBe('function');
    expect(typeof NOTIFICATION_PORT).toBe('symbol');
  });

  it('posts the event to crm with the internal key and the subject as customerId', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    await new NotificationHttpAdapter(makeConfig()).notify(
      'LEAVE_APPROVED',
      '0811',
      VARS,
      'auth-1',
    );
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://crm:3012/api/v1/notifications/internal');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-internal-key']).toBe('k-secret');
    expect(JSON.parse(opts.body)).toEqual({
      event: 'LEAVE_APPROVED',
      phone: '0811',
      customerId: 'auth-1',
      vars: VARS,
    });
  });

  it('skips silently when the crm url is unset', async () => {
    await expect(
      new NotificationHttpAdapter(makeConfig('', 'k')).notify('LEAVE_APPROVED', '0811', {}, 'a'),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips silently when the internal key is unset', async () => {
    await expect(
      new NotificationHttpAdapter(makeConfig('http://crm:3012', '')).notify('X', '0811', {}, 'a'),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves on a non-2xx response instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(
      new NotificationHttpAdapter(makeConfig()).notify('LEAVE_REJECTED', '0811', {}, 'a'),
    ).resolves.toBeUndefined();
  });

  it('resolves when crm is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new NotificationHttpAdapter(makeConfig()).notify('LEAVE_SUBMITTED', '0811', {}, 'a'),
    ).resolves.toBeUndefined();
  });

  it('handles a non-Error throw in the catch branch', async () => {
    fetchMock.mockRejectedValue('boom-string');
    await expect(
      new NotificationHttpAdapter(makeConfig()).notify('HR_ANNOUNCEMENT', '0811', {}, 'a'),
    ).resolves.toBeUndefined();
  });

  it('aborts a hung crm call rather than hanging the HR request', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = new NotificationHttpAdapter(makeConfig()).notify('X', '0811', {}, 'a');
    jest.advanceTimersByTime(5000);
    await expect(pending).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
