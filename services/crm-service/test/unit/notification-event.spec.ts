import {
  NOTIFICATION_TEMPLATES,
  NotificationEvent,
  OPS_EVENTS,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';

describe('notification event catalogue', () => {
  it('has a non-empty template for every event', () => {
    for (const event of Object.values(NotificationEvent)) {
      expect(templateFor(event).length).toBeGreaterThan(0);
    }
  });

  it('leaves an unknown token intact so a typo is visible', () => {
    expect(renderMessage('Hi {{name}}, {{oops}}', { name: 'Budi' })).toBe('Hi Budi, {{oops}}');
  });
});

describe('HR events (A2)', () => {
  const HR_EVENTS = [
    NotificationEvent.LEAVE_SUBMITTED,
    NotificationEvent.LEAVE_APPROVED,
    NotificationEvent.LEAVE_REJECTED,
    NotificationEvent.HR_ANNOUNCEMENT,
  ];

  it('are staff-facing, so they sit in the ops feed', () => {
    for (const event of HR_EVENTS) expect(OPS_EVENTS).toContain(event);
  });

  it('renders a leave decision with every token filled', () => {
    const message = renderMessage(templateFor(NotificationEvent.LEAVE_APPROVED), {
      name: 'Budi',
      type: 'ANNUAL',
      from: '01 Agu 2026',
      to: '03 Agu 2026',
    });
    expect(message).toContain('Budi');
    expect(message).toContain('ANNUAL');
    expect(message).toContain('01 Agu 2026');
    expect(message).not.toContain('{{');
  });

  it('renders a rejection with its reason', () => {
    const message = renderMessage(templateFor(NotificationEvent.LEAVE_REJECTED), {
      name: 'Budi',
      type: 'SICK',
      from: '01 Agu 2026',
      to: '01 Agu 2026',
      reason: 'Butuh surat dokter',
    });
    expect(message).toContain('Butuh surat dokter');
    expect(message).not.toContain('{{');
  });

  it('renders an announcement from title + body alone', () => {
    const message = renderMessage(templateFor(NotificationEvent.HR_ANNOUNCEMENT), {
      title: 'Libur Idul Adha',
      body: 'Depot tutup 17 Juni.',
    });
    expect(message).toContain('Libur Idul Adha');
    expect(message).toContain('Depot tutup 17 Juni.');
    expect(message).not.toContain('{{');
  });
});

/*
 * B4. delivery-service has been sending `DELIVERY_RESCHEDULED` since reschedule shipped,
 * and it was never a member of this enum — so `@IsEnum(NotificationEvent)` answered 400,
 * and the sending adapter's catch logged a warning and moved on. Every reschedule
 * notification, 100% of them, was lost between two services that both believed they had
 * done their part.
 *
 * B6. `ORDER_DRIVER_ASSIGNED` is the message the customer never got at the moment their
 * own right to cancel ended.
 */
describe('B4/B6 — the two events the emitters were already sending or owed', () => {
  it.each(['DELIVERY_RESCHEDULED', 'ORDER_DRIVER_ASSIGNED'])('%s is a member', (name) => {
    expect(Object.values(NotificationEvent)).toContain(name);
  });

  it.each(['DELIVERY_RESCHEDULED', 'ORDER_DRIVER_ASSIGNED'])('%s has copy', (name) => {
    const template = NOTIFICATION_TEMPLATES[name as NotificationEvent];
    expect(template).toBeTruthy();
    expect(template).not.toBe('{{message}}');
  });

  it('both are customer-facing, so neither belongs in the ops feed', () => {
    expect(OPS_EVENTS).not.toContain(NotificationEvent.DELIVERY_RESCHEDULED);
    expect(OPS_EVENTS).not.toContain(NotificationEvent.ORDER_DRIVER_ASSIGNED);
  });
});
