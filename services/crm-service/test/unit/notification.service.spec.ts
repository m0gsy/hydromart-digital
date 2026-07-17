import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { NotificationEvent } from '../../src/domain/notification-event';
import { NotificationStatus } from '../../src/domain/notification-status';
import { InMemoryNotificationRepository } from '../support/fakes';

class FakePush {
  pushed: string[] = [];
  async sendToCustomer(customerId: string): Promise<void> {
    this.pushed.push(customerId);
  }
}

describe('NotificationService', () => {
  let repo: InMemoryNotificationRepository;
  let push: FakePush;
  let service: NotificationService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    push = new FakePush();
    service = new NotificationService(repo, push as unknown as PushService);
  });

  it('pushes to the customer devices when a customerId is present, skips otherwise', async () => {
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '+62800', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', { depot: 'D', item: 'G', quantity: '1', minimum: '5' });
    expect(push.pushed).toEqual(['cust-1']);
  });

  it('renders the event template with vars and stores it SENT in the inbox', async () => {
    const rec = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '+6281234567890',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    expect(rec.status).toBe(NotificationStatus.SENT);
    expect(rec.message).toContain('Budi');
    expect(rec.message).toContain('HM-1');
    expect(rec.customerId).toBe('cust-1');
    expect(repo.records).toHaveLength(1);
  });

  it('always writes an audit row for every event kind', async () => {
    for (const event of Object.values(NotificationEvent)) {
      await service.notify(event, '+62800', { name: 'A', orderNumber: 'HM-x' });
    }
    expect(repo.records).toHaveLength(Object.values(NotificationEvent).length);
  });

  it('listForCustomer returns only the caller rows, newest first, clamped', async () => {
    await service.notify(NotificationEvent.ORDER_RECEIVED, '+62800', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '+62800', { name: 'A', orderNumber: 'HM-2' }, 'cust-1');
    await service.notify(NotificationEvent.ORDER_RECEIVED, '+62801', { name: 'B', orderNumber: 'HM-3' }, 'cust-2');

    const feed = await service.listForCustomer('cust-1');
    expect(feed).toHaveLength(2);
    expect(feed.every((n) => n.customerId === 'cust-1')).toBe(true);
    expect(feed[0].createdAt.getTime()).toBeGreaterThanOrEqual(feed[1].createdAt.getTime());

    // clamp: limit floors at 1 even when asked for 0.
    expect(await service.listForCustomer('cust-1', 0)).toHaveLength(1);
  });

  it('listOpsFeed returns only operational events (STOCK_LOW), not customer messages', async () => {
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', {
      depot: 'JKT-01',
      item: 'Galon 19L',
      quantity: '3',
      minimum: '10',
    });
    await service.notify(NotificationEvent.ORDER_RECEIVED, '+62801', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');

    const feed = await service.listOpsFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0].event).toBe(NotificationEvent.STOCK_LOW);
  });
});
