import { ServiceUnavailableException } from '@nestjs/common';

import { CustomerReminderSourcePort } from '../../src/application/ports/customer-reminder-source.port';
import { CustomerReminderService } from '../../src/application/services/customer-reminder.service';
import { dayMonth, reminderDedupeKey, rupiah } from '../../src/domain/customer-reminder';
import { destinationFor } from '../../src/domain/notification-destination';
import { NotificationEvent, renderMessage, templateFor } from '../../src/domain/notification-event';
import { CrmConfigService } from '../../src/config/crm-config.service';
import { CustomerReminderSourceHttpAdapter } from '../../src/infrastructure/http/customer-reminder-source.http.adapter';

// 25 Nov 2026 17:00 WIB; tomorrow in WIB is the 26th.
const NOW = new Date('2026-11-25T10:00:00.000Z');

const build = (source: Partial<CustomerReminderSourcePort> = {}, created: (key: string) => boolean = () => true) => {
  const notifyOnce = jest.fn(async (_e, _p, _v, _c, _d, key: string) => ({ record: { id: key } as never, created: created(key) }));
  const port: CustomerReminderSourcePort = {
    subscriptionsDue: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    expiringPoints: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    unpaidOrders: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    ...source,
  };
  return { service: new CustomerReminderService({ notifyOnce } as never, port), notifyOnce, port };
};

describe('CustomerReminderService (HD-18)', () => {
  it('SUBSCRIPTION_TOMORROW asks for the WIB day after today and keys each plan by its delivery day', async () => {
    const { service, notifyOnce, port } = build({
      subscriptionsDue: jest.fn().mockResolvedValue({ truncated: false, rows: [
        { id: 's-1', customerId: 'c-1', productName: 'Galon 19L', quantity: 2, nextDeliveryAt: new Date('2026-11-26T01:00:00.000Z') },
      ] }),
    });
    const out = await service.run('SUBSCRIPTION_TOMORROW', '2026-11-25', NOW);
    const [from, to] = (port.subscriptionsDue as jest.Mock).mock.calls[0];
    expect([from.toISOString(), to.toISOString()]).toEqual(['2026-11-25T17:00:00.000Z', '2026-11-26T17:00:00.000Z']);
    expect(out).toEqual({ kind: 'SUBSCRIPTION_TOMORROW', date: '2026-11-25', candidates: 1, truncated: false, notified: 1, skipped: 0, whatsapp: 'pending' });
    expect(notifyOnce).toHaveBeenCalledWith(
      NotificationEvent.SUBSCRIPTION_TOMORROW,
      '',
      { product: 'Galon 19L', quantity: '2', date: '26 Nov' },
      'c-1',
      null,
      'customer-reminder:SUBSCRIPTION_TOMORROW:s-1:2026-11-26',
    );
  });

  it('POINTS_EXPIRING looks 7 days ahead and keys each lot once', async () => {
    const { service, notifyOnce, port } = build({
      expiringPoints: jest.fn().mockResolvedValue({ truncated: false, rows: [{ lotId: 'l-1', customerId: 'c-1', points: 120, expiresAt: new Date('2026-12-01T10:00:00Z') }] }),
    });
    await service.run('POINTS_EXPIRING', '2026-11-25', NOW);
    expect(port.expiringPoints).toHaveBeenCalledWith(7);
    expect(notifyOnce).toHaveBeenCalledWith(
      NotificationEvent.POINTS_EXPIRING, '', { points: '120', expires: '1 Des' }, 'c-1', null, 'customer-reminder:POINTS_EXPIRING:l-1',
    );
  });

  it('UNPAID_ORDER counts what was already sent as skipped', async () => {
    const { service } = build(
      { unpaidOrders: jest.fn().mockResolvedValue({ truncated: true, rows: [
        { orderId: 'o-1', customerId: 'c-1', orderNumber: 'HM-1', total: 1500000 },
        { orderId: 'o-2', customerId: 'c-2', orderNumber: 'HM-2', total: 500 },
      ] }) },
      (key) => key.endsWith('o-2'),
    );
    await expect(service.run('UNPAID_ORDER', '2026-11-25', NOW)).resolves.toMatchObject({ candidates: 2, truncated: true, notified: 1, skipped: 1 });
  });

  it('answers 503 when the source cannot be read or a reminder cannot be filed, so the same call is retried', async () => {
    const down = build({ unpaidOrders: jest.fn().mockRejectedValue(new Error('order-service down')) });
    await expect(down.service.run('UNPAID_ORDER', '2026-11-25', NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const flaky = build({ unpaidOrders: jest.fn().mockResolvedValue({ truncated: false, rows: [{ orderId: 'o-1', customerId: 'c-1', orderNumber: 'HM-1', total: 1 }] }) });
    flaky.notifyOnce.mockRejectedValueOnce(new Error('db'));
    await expect(flaky.service.run('UNPAID_ORDER', '2026-11-25', NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('defaults to the real clock', async () => {
    const { service } = build();
    await expect(service.run('UNPAID_ORDER', '2026-11-25')).resolves.toMatchObject({ candidates: 0 });
  });
});

describe('customer reminder copy and destinations (HD-18)', () => {
  it('speaks Indonesian and English, and taps through to the right screen', () => {
    expect(renderMessage(templateFor(NotificationEvent.UNPAID_ORDER, 'id'), { orderNumber: 'HM-1', amount: 'Rp1.000' })).toBe(
      'Pesanan HM-1 (Rp1.000) masih menunggu pembayaran. Selesaikan sekarang, pesanan yang belum dibayar dibatalkan otomatis.',
    );
    for (const e of [NotificationEvent.SUBSCRIPTION_TOMORROW, NotificationEvent.POINTS_EXPIRING, NotificationEvent.UNPAID_ORDER]) {
      expect(templateFor(e, 'en')).not.toBe(templateFor(e, 'id'));
    }
    expect(destinationFor(NotificationEvent.UNPAID_ORDER, { orderId: 'o-1' })).toBe('/orders/detail?id=o-1');
    expect(destinationFor(NotificationEvent.POINTS_EXPIRING)).toBe('/rewards');
    expect(destinationFor(NotificationEvent.SUBSCRIPTION_TOMORROW)).toBe('/subscriptions');
  });

  it('formats keys, WIB days and rupiah', () => {
    expect(reminderDedupeKey('UNPAID_ORDER', 'o-1')).toBe('customer-reminder:UNPAID_ORDER:o-1');
    expect(reminderDedupeKey('SUBSCRIPTION_TOMORROW', 's-1', '2026-11-26')).toBe('customer-reminder:SUBSCRIPTION_TOMORROW:s-1:2026-11-26');
    // 17:30 UTC is already the next day in WIB.
    expect(dayMonth(new Date('2026-12-31T17:30:00Z'))).toBe('1 Jan');
    expect(rupiah(1234567)).toBe('Rp1.234.567');
    expect(rupiah(0)).toBe('Rp0');
  });
});

describe('CustomerReminderSourceHttpAdapter (HD-18)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (over: Record<string, string> = {}) =>
    ({ orderServiceUrl: 'http://order:3004/', loyaltyServiceUrl: 'http://loyalty:3009', internalServiceKey: 'k', ...over }) as unknown as CrmConfigService;
  const answer = (body: unknown, ok = true) => jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

  it('reads the three lists from the owning services, with the internal key', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 's', customerId: 'c', productName: 'G', quantity: 1, nextDeliveryAt: '2026-11-26T01:00:00Z' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ lots: [{ lotId: 'l', customerId: 'c', points: 5, expiresAt: '2026-12-01T00:00:00Z' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ truncated: false, items: [{ orderId: 'o', customerId: 'c', orderNumber: 'n', total: 9 }] }) });
    global.fetch = f as never;
    const adapter = new CustomerReminderSourceHttpAdapter(config());
    const from = new Date('2026-11-25T17:00:00Z');
    const subs = await adapter.subscriptionsDue(from, new Date('2026-11-26T17:00:00Z'));
    expect(subs.rows[0]).toMatchObject({ id: 's', quantity: 1, nextDeliveryAt: new Date('2026-11-26T01:00:00Z') });
    expect(f.mock.calls[0][0]).toBe('http://order:3004/api/v1/customer-reminders/internal/subscriptions-due');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ from: from.toISOString(), to: '2026-11-26T17:00:00.000Z' });
    expect(f.mock.calls[0][1].headers['x-internal-key']).toBe('k');
    expect((await adapter.expiringPoints(7)).rows[0]).toMatchObject({ lotId: 'l', points: 5 });
    expect(f.mock.calls[1][0]).toBe('http://loyalty:3009/api/v1/loyalty/internal/expiring-lots?withinDays=7');
    expect(await adapter.unpaidOrders()).toEqual({ rows: [{ orderId: 'o', customerId: 'c', orderNumber: 'n', total: 9 }], truncated: false });
  });

  it('throws when a service is not configured, answers an error, or answers rubbish', async () => {
    const f = jest.fn();
    global.fetch = f as never;
    await expect(new CustomerReminderSourceHttpAdapter(config({ loyaltyServiceUrl: '' })).expiringPoints(7)).rejects.toThrow('missing');
    await expect(new CustomerReminderSourceHttpAdapter(config({ internalServiceKey: '' })).unpaidOrders()).rejects.toThrow('missing');
    expect(f).not.toHaveBeenCalled();
    global.fetch = answer({}, false) as never;
    await expect(new CustomerReminderSourceHttpAdapter(config()).unpaidOrders()).rejects.toThrow('order-service responded 500');
    global.fetch = answer({ nothing: 1 }) as never;
    await expect(new CustomerReminderSourceHttpAdapter(config()).unpaidOrders()).rejects.toThrow('malformed');
    global.fetch = answer({ items: [{ orderId: 'o', customerId: '', orderNumber: 'n', total: 1 }] }) as never;
    await expect(new CustomerReminderSourceHttpAdapter(config()).unpaidOrders()).rejects.toThrow('malformed');
    global.fetch = answer({ items: [{ orderId: 'o', customerId: 'c', orderNumber: 'n', total: 'x' }] }) as never;
    await expect(new CustomerReminderSourceHttpAdapter(config()).unpaidOrders()).rejects.toThrow('malformed');
    global.fetch = answer({ lots: [{ lotId: 'l', customerId: 'c', points: 1, expiresAt: 'not a date' }] }) as never;
    await expect(new CustomerReminderSourceHttpAdapter(config()).expiringPoints(7)).rejects.toThrow('malformed');
  });
});
