import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { MessageLocale, NotificationEvent } from '../../src/domain/notification-event';
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

  /*
   * UU PDP item 13 — the same rows, but on request rather than on a window.
   *
   * The sweep above is a WINDOW: 90 days. `docs/AUDIT_L3.md` §4.2 counted 3.033 notification
   * rows still carrying the phone numbers of people who had asked to be forgotten, because a
   * window is not an answer to "forget me today". Delete `erasePerson` and this fails.
   */
  it('erases one person on request, by id or by phone, and is idempotent', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new NotificationService(repo, { send: jest.fn() } as never);
    const row = (customerId: string | null, phone: string) =>
      repo.record({ event: 'X', phone, message: 'm', customerId, status: 'SENT', error: null } as never);

    await row('cust-1', '+628111');
    // No id at all — the shape that survived every previous deletion.
    await row(null, '+628111');
    await row('cust-2', '+628222');

    expect(await service.erasePerson('cust-1', '+628111')).toEqual({ erased: 2 });
    // Somebody else's history is untouched, and a retry erases nothing rather than failing.
    expect(await service.erasePerson('cust-1', '+628111')).toEqual({ erased: 0 });
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
    public locale: MessageLocale = 'id';
    public localeAsked: string[] = [];
    public localeFails = false;
    async localeFor(customerId: string): Promise<MessageLocale> {
      this.localeAsked.push(customerId);
      if (this.localeFails) throw new Error('customer-service unreachable');
      return this.locale;
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

/*
 * F8. Every operational alert — stock low, stock untracked, meter variance, the twice-daily
 * sales update, and a HIGH-severity courier incident — is addressed to a phone NUMBER, not
 * to an account, so it passed `customerId: null`. `notify()` skips push when there is no
 * customer id, so not one of them had a channel that could wake anybody: they landed in the
 * ops feed and waited for somebody to open a screen.
 *
 * With a depot on the alert, the recipients are that depot's own active staff — resolved
 * from auth-service, which owns the roster, rather than from a second copy here that would
 * drift the first time somebody changed depots.
 */
describe('F8 — an ops alert that can wake somebody', () => {
  const staffIds = ['s-1', 's-2'];

  function build(overrides: { ids?: string[]; throws?: boolean } = {}) {
    const sent: { customerId: string; body: string }[] = [];
    const push = {
      sendToCustomer: jest.fn(async (customerId: string, payload: { body: string }) => {
        sent.push({ customerId, body: payload.body });
      }),
    };
    const repo = { record: jest.fn(async (r: unknown) => r) };
    const depotStaff = {
      staffIdsForDepot: jest.fn(async () =>
        overrides.throws ? Promise.reject(new Error('auth down')) : (overrides.ids ?? staffIds),
      ),
    };
    const service = new NotificationService(
      repo as never,
      push as never,
      undefined,
      depotStaff as never,
    );
    return { service, sent, push, depotStaff, repo };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('pushes a HIGH courier incident to every active staff member at that depot', async () => {
    const { service, sent } = build();
    await service.notify(
      NotificationEvent.COURIER_INCIDENT,
      '+628000000000',
      { severity: 'HIGH', category: 'ACCIDENT', note: 'truk terguling' },
      null,
      'depot-1',
    );
    await flush();
    expect(sent.map((s) => s.customerId).sort()).toEqual(['s-1', 's-2']);
    expect(sent[0]!.body).toContain('truk terguling');
  });

  it('still writes the ops feed row when the roster cannot be read', async () => {
    const { service, repo, sent } = build({ throws: true });
    await service.notify(NotificationEvent.STOCK_LOW, '+628000000000', {}, null, 'depot-1');
    await flush();
    expect(repo.record).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it('says so rather than going quiet when a depot has nobody rostered', async () => {
    const { service, repo, sent } = build({ ids: [] });
    await service.notify(NotificationEvent.STOCK_LOW, '+628000000000', {}, null, 'depot-1');
    await flush();
    expect(repo.record).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it('does not route a CUSTOMER event to depot staff, even with a depot on it', async () => {
    const { service, depotStaff } = build();
    await service.notify(
      NotificationEvent.ORDER_DELIVERED,
      '+628111111111',
      { name: 'Wahyu', orderNumber: 'HM-1' },
      null,
      'depot-1',
    );
    await flush();
    expect(depotStaff.staffIdsForDepot).not.toHaveBeenCalled();
  });

  it('leaves an ops alert with no depot exactly as it was — feed only', async () => {
    const { service, depotStaff, repo } = build();
    await service.notify(NotificationEvent.STOCK_LOW, '+628000000000', {}, null, null);
    await flush();
    expect(depotStaff.staffIdsForDepot).not.toHaveBeenCalled();
    expect(repo.record).toHaveBeenCalledTimes(1);
  });
});

/*
 * F8. The port is @Optional for the same reason the preference port is: a deployment that
 * has not wired it must behave exactly as it did before — ops alerts reach the feed and no
 * device — rather than throw on a dependency that did not exist last release.
 */
describe('F8 — a deployment that has not wired the roster', () => {
  it('writes the ops feed row and pushes nothing', async () => {
    const repo = { record: jest.fn(async (r: unknown) => r) };
    const push = { sendToCustomer: jest.fn() };
    const service = new NotificationService(repo as never, push as never);
    await service.notify(NotificationEvent.STOCK_LOW, '+628000000000', {}, null, 'depot-1');
    await new Promise((r) => setImmediate(r));
    expect(repo.record).toHaveBeenCalledTimes(1);
    expect(push.sendToCustomer).not.toHaveBeenCalled();
  });
});

/*
 * O1a — the destination is computed for the push payload and then thrown away, so a tap
 * from the phone's tray lands on the right screen while the same notification in the
 * in-app list is dead text. This is the release that ships the column and starts WRITING
 * it; the list becomes tappable one release later, when every row already carries one.
 */
describe('recorded destination', () => {
  let repo: InMemoryNotificationRepository;
  let service: NotificationService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    service = new NotificationService(repo, new FakePush() as unknown as PushService);
  });

  it('stores the same destination the push payload gets', async () => {
    await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '+62800',
      { name: 'Budi', orderNumber: 'HM-1', orderId: 'o-9' },
      'cust-1',
    );
    expect(repo.records[0].destination).toBe('/orders/detail?id=o-9');
  });

  it('stores the fallback destination when the event carries no id', async () => {
    await service.notify(NotificationEvent.POINTS_EARNED, '+62800', { points: '10' }, 'cust-1');
    expect(repo.records[0].destination).toBe('/rewards');
  });

  it('stores null for an event with no screen to open', async () => {
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', {
      depot: 'D',
      item: 'G',
      quantity: '1',
      minimum: '5',
    });
    expect(repo.records[0].destination).toBeNull();
  });
});

/*
 * K5.4 — every notification row is written SENT with a null error, whatever happened to the
 * delivery. The push fan-out is fire-and-forget (F1, deliberately: transport must never
 * block a committed notification), and its failure only ever reached a log line reading
 * "skipped". So `FAILED` and the `error` column have never been written by anything, on any
 * row, ever: two columns that exist to say a message did not arrive, and cannot.
 *
 * The record still gets written either way — muting or losing push is not losing the row.
 * What changes is that the row stops CLAIMING delivery it never had.
 */
describe('a failed push is recorded, not just logged', () => {
  class ExplodingPush {
    async sendToCustomer(): Promise<void> {
      throw new Error('FCM 502');
    }
  }

  it('marks the row FAILED with the reason when the push throws', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new NotificationService(repo, new ExplodingPush() as unknown as PushService);
    const rec = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '+62800',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    // The write is synchronous with the call; the push settles after it.
    await new Promise((r) => setImmediate(r));
    const stored = repo.records.find((r) => r.id === rec.id);
    expect(stored?.status).toBe(NotificationStatus.FAILED);
    expect(stored?.error).toContain('FCM 502');
    // The message itself is still there to read in the app.
    expect(stored?.message).toContain('Budi');
  });

  it('leaves a delivered one SENT with no error', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new NotificationService(repo, new FakePush() as unknown as PushService);
    const rec = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '+62800',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    await new Promise((r) => setImmediate(r));
    const stored = repo.records.find((r) => r.id === rec.id);
    expect(stored?.status).toBe(NotificationStatus.SENT);
    expect(stored?.error).toBeNull();
  });

  it('does not invent a failure for a row that never had a push to make', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new NotificationService(repo, new ExplodingPush() as unknown as PushService);
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', {
      depot: 'D',
      item: 'G',
      quantity: '1',
      minimum: '5',
    });
    await new Promise((r) => setImmediate(r));
    expect(repo.records[0].status).toBe(NotificationStatus.SENT);
    expect(repo.records[0].error).toBeNull();
  });
});

/*
 * O6 — the ops feed had no depot filter at all: its own index comment says "no customer
 * filter" in as many words. Adding an "an order arrived" event without one would have shown
 * every depot the orders of every other depot, which is worse than the silence it replaces.
 */
describe('ops feed is scoped to the reader depot', () => {
  let repo: InMemoryNotificationRepository;
  let service: NotificationService;

  beforeEach(async () => {
    repo = new InMemoryNotificationRepository();
    service = new NotificationService(repo, new FakePush() as unknown as PushService);
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', { depot: 'A', item: 'G', quantity: '1', minimum: '5' }, null, 'depot-a');
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', { depot: 'B', item: 'G', quantity: '1', minimum: '5' }, null, 'depot-b');
    // A row from before the column existed: no depot at all.
    await repo.record({
      event: NotificationEvent.METER_VARIANCE,
      customerId: null,
      phone: '+62800',
      message: 'legacy',
      status: NotificationStatus.SENT,
      error: null,
      destination: null,
      depotId: null,
    });
  });

  it('shows a depot its own rows and the ones belonging to no depot', async () => {
    const feed = await service.listOpsFeed('staff-1', ['depot-a']);
    expect(feed.map((r) => r.depotId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['depot-a', null]);
  });

  it('shows every depot to a reader with no depot of their own', async () => {
    const feed = await service.listOpsFeed('hq-1');
    expect(feed).toHaveLength(3);
  });

  it('writes the depot only for operational rows', async () => {
    await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '+62800',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
      'depot-a',
    );
    const customerRow = repo.records.find((r) => r.event === NotificationEvent.ORDER_CONFIRMED);
    expect(customerRow?.depotId).toBeNull();
  });
});

/**
 * K5.3 · the language a customer chose has to reach the sender.
 *
 * The choice only ever lived in one browser's localStorage, and WhatsApp and push are
 * rendered here — so somebody reading the app in English got every order update in
 * Indonesian. These assert the render, not the column: the row stores the text forever.
 */
describe('NotificationService · K5.3 recipient language', () => {
  class FakePrefs {
    public locale: MessageLocale = 'id';
    public localeFails = false;
    public localeAsked: string[] = [];
    async pushAllowed(): Promise<boolean> {
      return true;
    }
    async marketingAllowed(): Promise<boolean> {
      return true;
    }
    async localeFor(customerId: string): Promise<MessageLocale> {
      this.localeAsked.push(customerId);
      if (this.localeFails) throw new Error('customer-service unreachable');
      return this.locale;
    }
  }

  let repo: InMemoryNotificationRepository;
  let prefs: FakePrefs;
  let service: NotificationService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    prefs = new FakePrefs();
    service = new NotificationService(repo, new FakePush() as unknown as PushService, prefs);
  });

  it('writes the stored row in the customer’s own language', async () => {
    prefs.locale = 'en';
    const record = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '08123',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    expect(record.message).toContain('Order HM-1 is confirmed');
    expect(prefs.localeAsked).toEqual(['cust-1']);
  });

  it('writes Indonesian for a customer who never changed it', async () => {
    const record = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '08123',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    expect(record.message).toContain('sudah kami konfirmasi');
  });

  // An ops alert is addressed to a depot's number, not to an account — there is no
  // customer whose language could be read, and no round trip worth making.
  it('never asks for an operational alert', async () => {
    await service.notify(NotificationEvent.STOCK_LOW, '08123', { depot: 'D1' }, null, 'depot-1');
    expect(prefs.localeAsked).toEqual([]);
  });

  // Fails OPEN, to the product default: an unreadable preference costs a reader their
  // language, never the message.
  it('falls back to Indonesian when the directory is unreachable', async () => {
    prefs.localeFails = true;
    const record = await service.notify(
      NotificationEvent.ORDER_CONFIRMED,
      '08123',
      { name: 'Budi', orderNumber: 'HM-1' },
      'cust-1',
    );
    expect(record.message).toContain('sudah kami konfirmasi');
  });
});
