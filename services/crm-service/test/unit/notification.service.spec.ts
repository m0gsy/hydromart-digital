import { NotificationService } from '../../src/application/services/notification.service';
import { NotificationEvent } from '../../src/domain/notification-event';
import { NotificationStatus } from '../../src/domain/notification-status';
import { FakeWhatsappBroadcast, InMemoryNotificationRepository } from '../support/fakes';

describe('NotificationService', () => {
  let repo: InMemoryNotificationRepository;
  let whatsapp: FakeWhatsappBroadcast;
  let service: NotificationService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    whatsapp = new FakeWhatsappBroadcast();
    service = new NotificationService(repo, whatsapp);
  });

  it('renders the event template with vars and sends via WhatsApp', async () => {
    const rec = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '+6281234567890',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    expect(rec.status).toBe(NotificationStatus.SENT);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].message).toContain('Budi');
    expect(whatsapp.sent[0].message).toContain('HM-1');
    expect(rec.customerId).toBe('cust-1');
  });

  it('records FAILED (never throws) when WhatsApp delivery fails', async () => {
    whatsapp.failOn('+6281234567890');
    const rec = await service.notify(
      NotificationEvent.ORDER_DELIVERED,
      '+6281234567890',
      { name: 'Siti', orderNumber: 'HM-2' },
    );
    expect(rec.status).toBe(NotificationStatus.FAILED);
    expect(rec.error).toBeTruthy();
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
});
