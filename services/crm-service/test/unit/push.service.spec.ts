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
  async listForCustomer(customerId: string): Promise<WebPushSubscriptionRecord[]> {
    return this.rows.filter((r) => r.customerId === customerId);
  }
  async deleteByEndpoint(endpoint: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.endpoint !== endpoint);
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
    await service.subscribe('cust-1', sub('https://push/1'));
    await service.sendToCustomer('cust-1', { title: 'T', body: 'B' });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].payload.body).toBe('B');
  });

  it('re-registering the same endpoint does not duplicate it', async () => {
    await service.subscribe('cust-1', sub('https://push/1'));
    await service.subscribe('cust-1', sub('https://push/1'));
    expect(subs.rows).toHaveLength(1);
  });

  it('prunes a subscription the push service reports gone (404/410)', async () => {
    await service.subscribe('cust-1', sub('https://push/dead'));
    sender.gone.add('https://push/dead');
    await service.sendToCustomer('cust-1', { title: 'T', body: 'B' });
    expect(subs.rows).toHaveLength(0);
  });

  it('unsubscribe removes the endpoint', async () => {
    await service.subscribe('cust-1', sub('https://push/1'));
    await service.unsubscribe('https://push/1');
    expect(subs.rows).toHaveLength(0);
  });
});
