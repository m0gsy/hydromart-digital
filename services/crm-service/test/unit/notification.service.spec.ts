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

    const feed = await service.listOpsFeed('staff-1');
    expect(feed).toHaveLength(1);
    expect(feed[0].event).toBe(NotificationEvent.STOCK_LOW);
    expect(feed[0].readAt).toBeNull();
  });
});

describe('NotificationService ops read state (per staff member)', () => {
  let repo: InMemoryNotificationRepository;
  let service: NotificationService;

  const stockLow = () =>
    service.notify(NotificationEvent.STOCK_LOW, '+62800', {
      depot: 'JKT-01',
      item: 'Galon 19L',
      quantity: '3',
      minimum: '10',
    });

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    service = new NotificationService(repo, { sendToCustomer: async () => {} } as unknown as PushService);
  });

  it('marks one read for the caller only — a second staff member still sees it unread', async () => {
    const n = await stockLow();

    const readAt = await service.markOpsRead(n.id, 'staff-1');
    expect(readAt).toBeInstanceOf(Date);

    expect((await service.listOpsFeed('staff-1'))[0].readAt).toEqual(readAt);
    expect((await service.listOpsFeed('staff-2'))[0].readAt).toBeNull();
  });

  it('is idempotent: re-reading keeps the first timestamp', async () => {
    const n = await stockLow();
    const first = await service.markOpsRead(n.id, 'staff-1');
    expect(await service.markOpsRead(n.id, 'staff-1')).toEqual(first);
  });

  it('returns null for an unknown id and for a customer-inbox row (not an ops event)', async () => {
    const customerRow = await service.notify(
      NotificationEvent.ORDER_RECEIVED,
      '+62801',
      { name: 'A', orderNumber: 'HM-1' },
      'cust-1',
    );
    expect(await service.markOpsRead('11111111-1111-1111-1111-111111111111', 'staff-1')).toBeNull();
    expect(await service.markOpsRead(customerRow.id, 'staff-1')).toBeNull();
  });

  it('mark-all marks every feed row once and reports 0 on a repeat', async () => {
    await stockLow();
    await stockLow();

    expect(await service.markAllOpsRead('staff-1')).toBe(2);
    expect(await service.markAllOpsRead('staff-1')).toBe(0);
    expect((await service.listOpsFeed('staff-1')).every((n) => n.readAt !== null)).toBe(true);
    expect((await service.listOpsFeed('staff-2')).every((n) => n.readAt === null)).toBe(true);
  });

  it('mark-all counts only the rows newly marked after a single read', async () => {
    const first = await stockLow();
    await stockLow();
    await service.markOpsRead(first.id, 'staff-1');
    expect(await service.markAllOpsRead('staff-1')).toBe(1);
  });
});

describe('NotificationService.purgeOlderThan (retention enforcement)', () => {
  it('drops only history older than the cutoff', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new NotificationService(repo, { send: jest.fn() } as never);
    await repo.record({
      event: 'X',
      phone: '+628',
      message: 'm',
      customerId: null,
      status: 'SENT',
      error: null,
    } as never);

    // Every seeded row predates a far-future cutoff, so all of them go.
    const far = new Date('2099-01-01T00:00:00.000Z');
    expect(await service.purgeOlderThan(far)).toEqual({ deleted: 1 });
    // Nothing is left, so a second sweep deletes nothing rather than failing.
    expect(await service.purgeOlderThan(far)).toEqual({ deleted: 0 });
  });
});

/**
 * F1 · a preference nobody reads is not a preference.
 *
 * `/account` offers a push toggle, customer-service stores it, and the sender never asked.
 * A customer who turned push off kept receiving push. (The same screen offered `email`
 * and `whatsapp` switches for two channels that exist nowhere in this repo — that half is
 * fixed by removing the controls, not by reading them.)
 */
describe('NotificationService · F1 push preference', () => {
  class FakePrefs {
    public allowed = true;
    public fail = false;
    public asked: string[] = [];
    async pushAllowed(customerId: string): Promise<boolean> {
      this.asked.push(customerId);
      if (this.fail) throw new Error('customer-service unreachable');
      return this.allowed;
    }
    // F1b lives on the same port; `notify` never consults it (the broadcast gate does).
    async marketingAllowed(): Promise<boolean> {
      return true;
    }
  }

  let repo: InMemoryNotificationRepository;
  let push: FakePush;
  let prefs: FakePrefs;
  let service: NotificationService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    push = new FakePush();
    prefs = new FakePrefs();
    service = new NotificationService(repo, push as unknown as PushService, prefs);
  });

  /** `notify` fires push without awaiting it; let the microtask chain drain. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('does not push to a customer who turned push off', async () => {
    prefs.allowed = false;
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '+62800', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');
    await settle();
    expect(push.pushed).toEqual([]);
  });

  it('still writes the inbox row — the feed is the record, not the transport', async () => {
    prefs.allowed = false;
    const rec = await service.notify(NotificationEvent.ORDER_CONFIRMED, '+62800', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');
    await settle();
    expect(rec.status).toBe(NotificationStatus.SENT);
    expect(repo.records).toHaveLength(1);
  });

  it('pushes when the customer left it on', async () => {
    prefs.allowed = true;
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '+62800', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');
    await settle();
    expect(push.pushed).toEqual(['cust-1']);
  });

  it('never asks about a notification with no customer — there is nothing to push to', async () => {
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', { depot: 'D', item: 'G', quantity: '1', minimum: '5' });
    await settle();
    expect(prefs.asked).toEqual([]);
    expect(push.pushed).toEqual([]);
  });

  it('fails OPEN when the preference cannot be read', async () => {
    prefs.fail = true;
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '+62800', { name: 'A', orderNumber: 'HM-1' }, 'cust-1');
    await settle();
    expect(push.pushed).toEqual(['cust-1']);
  });
});
