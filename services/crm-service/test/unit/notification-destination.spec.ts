import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { destinationFor, storedDestinationFor } from '../../src/domain/notification-destination';
import { NotificationEvent, templateFor } from '../../src/domain/notification-event';
import { PushPayload } from '../../src/application/ports/push-sender.port';
import { InMemoryNotificationRepository } from '../support/fakes';

describe('destinationFor', () => {
  const ORDER_EVENTS = [
    NotificationEvent.ORDER_RECEIVED,
    NotificationEvent.ORDER_CONFIRMED,
    NotificationEvent.ORDER_ON_DELIVERY,
    NotificationEvent.ORDER_DELIVERED,
    NotificationEvent.ORDER_COMPLETED,
    NotificationEvent.ORDER_CANCELLED,
    // The rating form is on the order itself.
    NotificationEvent.REVIEW_REQUEST,
    // Money about an order opens that order.
    NotificationEvent.PAYMENT_FAILED,
    NotificationEvent.PAYMENT_REMINDER,
    NotificationEvent.REFUND_PROCESSED,
  ];

  it.each(ORDER_EVENTS)('%s opens that order in the query-param route', (event) => {
    expect(destinationFor(event, { orderId: 'ord-1' })).toBe('/orders/detail?id=ord-1');
  });

  it('escapes the id rather than trusting it to be url-safe', () => {
    expect(destinationFor(NotificationEvent.ORDER_RECEIVED, { orderId: 'a b&c' })).toBe(
      '/orders/detail?id=a%20b%26c',
    );
  });

  it('falls back to the order list when the emitter sent no id', () => {
    expect(destinationFor(NotificationEvent.ORDER_DELIVERED, { name: 'Budi' })).toBe('/orders');
  });

  it.each([
    [NotificationEvent.POINTS_EARNED, '/rewards'],
    [NotificationEvent.VOUCHER_GRANTED, '/vouchers'],
    [NotificationEvent.VOUCHER_EXPIRING, '/vouchers'],
    [NotificationEvent.REORDER_REMINDER, '/products'],
    // The customer's own gallon deposit card is on the account screen — what they hold and
    // what deposit is waiting for them is exactly what the reminder is about.
    [NotificationEvent.GALLON_RETURN_REMINDER, '/account'],
    // Where the tiers and their benefits are shown — the thing the message tells them about.
    [NotificationEvent.MEMBERSHIP_TIER_UPGRADED, '/rewards'],
    [NotificationEvent.CUSTOMER_REGISTERED, '/'],
  ])('%s opens %s', (event, url) => {
    expect(destinationFor(event, {})).toBe(url);
  });

  // O6: "new order in" must open the order in the ops queue, not the notification list.
  // `/dashboard/orders?order=<id>` is the screen the queue already deep-links with.
  it.each([
    NotificationEvent.DEPOT_ORDER_INCOMING,
    NotificationEvent.DEPOT_ORDER_RESCHEDULED,
    NotificationEvent.DEPOT_ORDER_CANCELLED,
    NotificationEvent.DEPOT_PAYMENT_UNCONFIRMED,
  ])(
    '%s opens that order in the ops queue',
    (event) => {
      expect(destinationFor(event, { orderId: 'ord-1' })).toBe('/dashboard/orders?order=ord-1');
      expect(destinationFor(event, {})).toBe('/dashboard/orders');
    },
  );

  it("opens a courier's new delivery on its detail screen, or the console without an id", () => {
    expect(destinationFor(NotificationEvent.COURIER_DELIVERY_ASSIGNED, { deliveryId: 'd 1' })).toBe(
      '/driver/deliveries/detail?id=d%201',
    );
    expect(destinationFor(NotificationEvent.COURIER_DELIVERY_ASSIGNED, {})).toBe('/driver');
  });

  it("opens a manager's pending approval, or the queue without an id", () => {
    expect(destinationFor(NotificationEvent.APPROVAL_REQUESTED, { approvalId: 'a 1' })).toBe(
      '/m/manager/approvals/detail?id=a%201',
    );
    expect(destinationFor(NotificationEvent.APPROVAL_REQUESTED, {})).toBe('/m/manager/approvals');
  });

  it.each([
    [NotificationEvent.PAYSLIP_READY, '/hr/me/payroll'],
    [NotificationEvent.ATTENDANCE_LATE, '/hr/me/attendance'],
    [NotificationEvent.SHIFT_REMINDER, '/hr/me/check-in'],
  ])('%s opens the employee self-service page %s', (event, url) => {
    expect(destinationFor(event, {})).toBe(url);
  });

  // The receipt is checked beside its order (order-detail's proof panel), not on the QRIS
  // settings screen, which the depot head cannot even open (`depotAdmin`).
  it('opens the order whose receipt waits to be verified', () => {
    expect(destinationFor(NotificationEvent.DEPOT_PAYMENT_PROOF, { orderId: 'o1' })).toBe(
      '/dashboard/orders?order=o1',
    );
  });

  it('says to open the order, the screen the push now lands on', () => {
    expect(templateFor(NotificationEvent.DEPOT_PAYMENT_PROOF, 'id')).toMatch(/Buka pesanan/);
    expect(templateFor(NotificationEvent.DEPOT_PAYMENT_PROOF, 'id')).not.toMatch(/menu Pembayaran/);
    expect(templateFor(NotificationEvent.DEPOT_PAYMENT_PROOF, 'en')).toMatch(/Open the order/);
  });

  it('falls back to the queue for a receipt with no order id', () => {
    expect(destinationFor(NotificationEvent.DEPOT_PAYMENT_PROOF, {})).toBe('/dashboard/orders');
  });

  /*
   * Flow 6a (plan PR-6): the events that still fell to the inbox now open their screen. Each is
   * in the Ops APK from v1.15.0 on (checked against tag 10f600f65's prune list).
   */
  it.each([
    [NotificationEvent.STOCK_LOW, {}, '/dashboard/inventory?low=1'],
    [NotificationEvent.STOCK_UNTRACKED, {}, '/dashboard/inventory?low=1'],
    [NotificationEvent.METER_VARIANCE, {}, '/dashboard/meter'],
    [NotificationEvent.COURIER_INCIDENT, { incidentId: 'i 1' }, '/dashboard/incidents?id=i%201'],
    [NotificationEvent.COURIER_INCIDENT, {}, '/dashboard/incidents'],
    [NotificationEvent.DELIVERY_SLA_BREACHED, { orderId: 'o-1' }, '/dashboard/orders?order=o-1'],
    [NotificationEvent.DELIVERY_SLA_BREACHED, {}, '/dashboard/orders'],
    [NotificationEvent.DEPOT_SALES_UPDATE, {}, '/dashboard/reports'],
    [NotificationEvent.LEAVE_APPROVED, { leaveId: 'l-1' }, '/hr/me/leave?id=l-1'],
    [NotificationEvent.LEAVE_REJECTED, {}, '/hr/me/leave'],
    [NotificationEvent.HR_ANNOUNCEMENT, { announcementId: 'a-1' }, '/hr/me/announcements?id=a-1'],
    [NotificationEvent.HR_ANNOUNCEMENT, {}, '/hr/me/announcements'],
    [NotificationEvent.SUBSCRIPTION_PAUSED, {}, '/subscriptions'],
    [NotificationEvent.PAYSLIP_READY, { payrollId: 'p 1' }, '/hr/me/payroll/detail?id=p%201'],
  ])('%s %j opens %s', (event, vars, url) => {
    expect(destinationFor(event, vars)).toBe(url);
    expect(storedDestinationFor(event, vars)).toBe(url);
  });

  // Owner decision 2026-11-19: /hr/leave is not in the Ops APK up to v1.15.0, so a leave
  // request opens it only once the brake is released; held (the default), it stays the inbox.
  it('names the depot on a depot screen when the alert says which', () => {
    expect(destinationFor(NotificationEvent.METER_VARIANCE, {}, { depotId: 'd 1' })).toBe(
      '/dashboard/meter?depot=d%201',
    );
    expect(
      destinationFor(NotificationEvent.COURIER_INCIDENT, { incidentId: 'i-1' }, { depotId: 'd-1' }),
    ).toBe('/dashboard/incidents?id=i-1&depot=d-1');
    expect(destinationFor(NotificationEvent.DEPOT_SALES_UPDATE, {}, { depotId: null })).toBe(
      '/dashboard/reports',
    );
  });

  it('opens the leave queue for a new request only while its brake is released', () => {
    expect(destinationFor(NotificationEvent.LEAVE_SUBMITTED, { leaveId: 'l-1' })).toBe('/notifications');
    expect(storedDestinationFor(NotificationEvent.LEAVE_SUBMITTED, { leaveId: 'l-1' })).toBeNull();
    expect(
      destinationFor(NotificationEvent.LEAVE_SUBMITTED, { leaveId: 'l-1' }, { leaveScreen: true }),
    ).toBe('/hr/leave?id=l-1');
    expect(destinationFor(NotificationEvent.LEAVE_SUBMITTED, {}, { leaveScreen: true })).toBe('/hr/leave');
  });

  /*
   * The kasbon events are the exception, and it is a deliberate one: unlike leave, the two
   * directions land on two screens that are not role-ambiguous. Waking somebody's phone and
   * then dropping them on a list of notifications tells them something is waiting without
   * taking them to it.
   */
  it.each([
    [NotificationEvent.LOAN_REQUEST_SUBMITTED, '/hr/loans/requests'],
    [NotificationEvent.LOAN_REQUEST_APPROVED, '/hr/me/kasbon'],
    [NotificationEvent.LOAN_REQUEST_REJECTED, '/hr/me/kasbon'],
  ])('%s opens %s on the phone that was woken', (event, url) => {
    expect(destinationFor(event, {})).toBe(url);
    // …and the inbox row is tappable too, because the destination is not the inbox itself.
    expect(storedDestinationFor(event, {})).toBe(url);
  });
});

describe('NotificationService push destination', () => {
  it('sends the per-event destination, not the inbox for everything', async () => {
    const payloads: PushPayload[] = [];
    const push = {
      sendToCustomer: async (_id: string, payload: PushPayload) => {
        payloads.push(payload);
      },
    } as unknown as PushService;
    const service = new NotificationService(new InMemoryNotificationRepository(), push);

    await service.notify(
      NotificationEvent.ORDER_ON_DELIVERY,
      '+62800',
      { name: 'Budi', orderNumber: 'HM-1', orderId: 'ord-9' },
      'cust-1',
    );
    // The push is fire-and-forget inside notify(); let the microtask queue drain.
    await Promise.resolve();

    expect(payloads[0]?.url).toBe('/orders/detail?id=ord-9');
    // The id is a routing hint, never copy — no template names it.
    expect(payloads[0]?.body).not.toContain('ord-9');
  });
});

/*
 * O1 — what gets STORED is not what a push gets. A push always needs a landing screen, so
 * the fallback is the inbox; a row already inside that inbox must not link to itself.
 */
describe('storedDestinationFor', () => {
  it('keeps a real screen', () => {
    expect(storedDestinationFor(NotificationEvent.POINTS_EARNED)).toBe('/rewards');
    expect(storedDestinationFor(NotificationEvent.ORDER_CONFIRMED, { orderId: 'o-1' })).toBe(
      '/orders/detail?id=o-1',
    );
  });

  it('is null where the push would fall back to the inbox itself', () => {
    expect(storedDestinationFor(NotificationEvent.BROADCAST, {})).toBeNull();
    // Called with no vars or options at all: a held brake is the inbox too.
    expect(storedDestinationFor(NotificationEvent.LEAVE_SUBMITTED)).toBeNull();
  });
});
