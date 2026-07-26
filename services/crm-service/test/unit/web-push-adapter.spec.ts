import { CrmConfigService } from '../../src/config/crm-config.service';
import { WebPushSenderAdapter } from '../../src/infrastructure/webpush/web-push.sender.adapter';
import { WebPushSubscriptionRecord } from '../../src/application/ports/push.repository';

// Exercises the REAL Web Push transport against a mocked `web-push` library: the disabled
// (blank VAPID) no-op, the success path, the 404/410 "gone" pruning signal, a non-gone error
// status, and a thrown Error with no statusCode. Never throws (PushSenderPort contract).

const setVapidDetails = jest.fn();
const sendNotification = jest.fn();
jest.mock('web-push', () => ({
  setVapidDetails: (...a: unknown[]): unknown => setVapidDetails(...a),
  sendNotification: (...a: unknown[]): unknown => sendNotification(...a),
}));

function config(over: Partial<{ publicKey: string; privateKey: string; subject: string }> = {}): CrmConfigService {
  return {
    vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:x', ...over },
  } as unknown as CrmConfigService;
}

const sub: WebPushSubscriptionRecord = {
  id: 's1',
  customerId: 'c1',
  endpoint: 'https://push.example/very-long-endpoint-value-goes-here-1234567890',
  p256dh: 'k',
  auth: 'a',
};

beforeEach(() => {
  setVapidDetails.mockReset();
  sendNotification.mockReset();
});

describe('WebPushSenderAdapter', () => {
  it('is a no-op (ok:false) and configures no VAPID when keys are blank', async () => {
    const adapter = new WebPushSenderAdapter(config({ publicKey: '', privateKey: '' }));
    expect(setVapidDetails).not.toHaveBeenCalled();
    expect(await adapter.send(sub, { title: 'T', body: 'B' })).toEqual({ ok: false });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('registers VAPID details and delivers when enabled', async () => {
    sendNotification.mockResolvedValue(undefined);
    const adapter = new WebPushSenderAdapter(config());
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:x', 'pub', 'priv');
    expect(await adapter.send(sub, { title: 'T', body: 'B' })).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])('reports gone on a %s so the caller prunes the subscription', async (status) => {
    sendNotification.mockRejectedValue({ statusCode: status });
    const adapter = new WebPushSenderAdapter(config());
    expect(await adapter.send(sub, { title: 'T', body: 'B' })).toEqual({ ok: false, gone: true });
  });

  it('reports ok:false (not gone) on a non-404/410 status', async () => {
    sendNotification.mockRejectedValue({ statusCode: 500 });
    const adapter = new WebPushSenderAdapter(config());
    expect(await adapter.send(sub, { title: 'T', body: 'B' })).toEqual({ ok: false });
  });

  it('reports ok:false when the error carries no statusCode', async () => {
    sendNotification.mockRejectedValue(new Error('boom'));
    const adapter = new WebPushSenderAdapter(config());
    expect(await adapter.send(sub, { title: 'T', body: 'B' })).toEqual({ ok: false });
  });
});
