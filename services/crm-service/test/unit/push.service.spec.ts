import { PushService } from '../../src/application/services/push.service';
import { PushSenderPort, PushPayload } from '../../src/application/ports/push-sender.port';
import {
  PushSubscriptionRepository,
  SaveSubscriptionData,
  WebPushSubscriptionRecord,
} from '../../src/application/ports/push.repository';

class FakeSubs implements PushSubscriptionRepository {
  rows: WebPushSubscriptionRecord[] = [];
  async upsert(data: SaveSubscriptionData): Promise<WebPushSubscriptionRecord> {
    const existing = this.rows.find((r) => r.endpoint === data.endpoint);
    if (existing) {
      Object.assign(existing, data);
      return existing;
    }
    const row = { id: `s-${this.rows.length}`, ...data };
    this.rows.push(row);
    return row;
  }
  async findByEndpoint(endpoint: string): Promise<WebPushSubscriptionRecord | null> {
    return this.rows.find((r) => r.endpoint === endpoint) ?? null;
  }
  async listForCustomer(customerId: string): Promise<WebPushSubscriptionRecord[]> {
    return this.rows.filter((r) => r.customerId === customerId);
  }
  async deleteByEndpoint(endpoint: string, customerId?: string): Promise<void> {
    this.rows = this.rows.filter(
      (r) => !(r.endpoint === endpoint && (!customerId || r.customerId === customerId)),
    );
  }
}

class FakeSender implements PushSenderPort {
  sent: { endpoint: string; payload: PushPayload }[] = [];
  gone = new Set<string>();
  async send(sub: WebPushSubscriptionRecord, payload: PushPayload) {
    if (this.gone.has(sub.endpoint)) return { ok: false, gone: true };
    this.sent.push({ endpoint: sub.endpoint, payload });
    return { ok: true };
  }
}

describe('PushService', () => {
  let subs: FakeSubs;
  let sender: FakeSender;
  let service: PushService;

  beforeEach(() => {
    subs = new FakeSubs();
    sender = new FakeSender();
    service = new PushService(subs, sender);
  });

  const sub = (endpoint: string) => ({ endpoint, p256dh: 'k', auth: 'a' });

  it('registers a device and fans a payload out to it', async () => {
    await service.subscribe('cust-1', sub('https://fcm.googleapis.com/fcm/send/1'));
    await service.sendToCustomer('cust-1', { title: 'T', body: 'B' });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].payload.body).toBe('B');
  });

  it('re-registering the same endpoint does not duplicate it', async () => {
    await service.subscribe('cust-1', sub('https://fcm.googleapis.com/fcm/send/1'));
    await service.subscribe('cust-1', sub('https://fcm.googleapis.com/fcm/send/1'));
    expect(subs.rows).toHaveLength(1);
  });

  it('prunes a subscription the push service reports gone (404/410)', async () => {
    await service.subscribe('cust-1', sub('https://fcm.googleapis.com/fcm/send/dead'));
    sender.gone.add('https://fcm.googleapis.com/fcm/send/dead');
    await service.sendToCustomer('cust-1', { title: 'T', body: 'B' });
    expect(subs.rows).toHaveLength(0);
  });

  it('unsubscribe removes the endpoint', async () => {
    await service.subscribe('cust-1', sub('https://fcm.googleapis.com/fcm/send/1'));
    await service.unsubscribe('cust-1', 'https://fcm.googleapis.com/fcm/send/1');
    expect(subs.rows).toHaveLength(0);
  });

  // CRM-6: never a request to a host the caller chose.
  it.each(['https://evil.example/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'fcm:', 'nope'])(
    'refuses the endpoint %s',
    async (endpoint) => {
      await expect(service.subscribe('cust-1', sub(endpoint))).rejects.toThrow('tidak dikenal');
      expect(subs.rows).toHaveLength(0);
    },
  );

  it.each([
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-sg2p.notify.windows.com/w/?token=x',
    'https://web.push.apple.com/abc',
    'fcm:DEVICE-TOKEN',
  ])('accepts the push service endpoint %s', async (endpoint) => {
    await expect(service.subscribe('cust-1', sub(endpoint))).resolves.toBeDefined();
  });

  // CRM-5: taking a keyed device over needs its keys; an FCM token moves with the phone.
  it('moves a device to another account only with its keys, and an FCM token freely', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/owned';
    await service.subscribe('cust-1', sub(endpoint));
    await expect(
      service.subscribe('cust-2', { endpoint, p256dh: 'other', auth: 'other' }),
    ).rejects.toThrow('akun lain');
    expect(subs.rows[0].customerId).toBe('cust-1');
    await service.subscribe('cust-2', sub(endpoint));
    expect(subs.rows[0].customerId).toBe('cust-2');

    await service.subscribe('cust-1', { endpoint: 'fcm:TOKEN', p256dh: '', auth: '' });
    await service.subscribe('cust-2', { endpoint: 'fcm:TOKEN', p256dh: '', auth: '' });
    expect(subs.rows.find((r) => r.endpoint === 'fcm:TOKEN')?.customerId).toBe('cust-2');
  });

  it('leaves a device belonging to another account alone', async () => {
    await service.subscribe('cust-1', sub('https://fcm.googleapis.com/fcm/send/1'));
    await service.unsubscribe('cust-2', 'https://fcm.googleapis.com/fcm/send/1');
    expect(subs.rows).toHaveLength(1);
  });
});
