import {
  addWorkingDays,
  PaymentMethod,
  PaymentStatus,
  WEBHOOK_MAX_SKEW_MS,
  canTransition,
  isWebhookFresh,
  webhookSigningPayload,
  isOnlineMethod,
  isRefundable,
} from '../../src/domain/payment';

describe('Payment domain', () => {
  it('classifies online vs offline methods', () => {
    expect(isOnlineMethod(PaymentMethod.EWALLET)).toBe(true);
    expect(isOnlineMethod(PaymentMethod.VA)).toBe(true);
    expect(isOnlineMethod(PaymentMethod.CASH)).toBe(false);
    expect(isOnlineMethod(PaymentMethod.TRANSFER)).toBe(false);
    // QRIS is a direct-to-depot manual method (static QRIS confirmed by staff), not gateway.
    expect(isOnlineMethod(PaymentMethod.QRIS)).toBe(false);
  });

  it('allows only legal status transitions', () => {
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.PAID)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.FAILED)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.CANCELLED)).toBe(true);
    expect(canTransition(PaymentStatus.PAID, PaymentStatus.REFUNDED)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.REFUNDED)).toBe(false);
    expect(canTransition(PaymentStatus.PAID, PaymentStatus.PENDING)).toBe(false);
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.PAID)).toBe(false);
  });

  it('marks only PAID payments refundable', () => {
    expect(isRefundable(PaymentStatus.PAID)).toBe(true);
    expect(isRefundable(PaymentStatus.PENDING)).toBe(false);
    expect(isRefundable(PaymentStatus.REFUNDED)).toBe(false);
  });
});

// Q-15: the HMAC covers every field except the signature, so what goes INTO the canonical
// string is the security contract. A provider sending an explicit null must produce the
// same string on both sides, and an undefined must not become the text "undefined".
describe('webhookSigningPayload', () => {
  it('sorts by key, drops the signature, and joins as k=v&k=v', () => {
    expect(
      webhookSigningPayload({
        reference: 'PAY-1',
        event: 'PAID',
        timestamp: 1785800000000,
        signature: 'deadbeef',
      }),
    ).toBe('event=PAID&reference=PAY-1&timestamp=1785800000000');
  });

  it('renders an explicit null as empty and omits an undefined field entirely', () => {
    expect(webhookSigningPayload({ a: null, b: undefined, c: 'x' })).toBe('a=&c=x');
  });

  it('is stable no matter what order the provider serialised the fields in', () => {
    const a = webhookSigningPayload({ event: 'PAID', reference: 'r', timestamp: 1 });
    const b = webhookSigningPayload({ timestamp: 1, reference: 'r', event: 'PAID' });
    expect(a).toBe(b);
  });
});

describe('isWebhookFresh', () => {
  const now = 1_785_800_000_000;
  it('accepts inside the window and rejects outside it, in both directions', () => {
    expect(isWebhookFresh(now, now)).toBe(true);
    expect(isWebhookFresh(now - WEBHOOK_MAX_SKEW_MS, now)).toBe(true);
    expect(isWebhookFresh(now + WEBHOOK_MAX_SKEW_MS, now)).toBe(true);
    expect(isWebhookFresh(now - WEBHOOK_MAX_SKEW_MS - 1, now)).toBe(false);
    // A clock ahead of ours is as suspicious as one behind: it buys a longer replay.
    expect(isWebhookFresh(now + WEBHOOK_MAX_SKEW_MS + 1, now)).toBe(false);
  });

  it('rejects a missing or unparseable timestamp', () => {
    expect(isWebhookFresh(Number.NaN, now)).toBe(false);
    expect(isWebhookFresh(Number.POSITIVE_INFINITY, now)).toBe(false);
  });
});

describe('addWorkingDays', () => {
  it('skips the weekend', () => {
    // Thu 2026-10-15 + 3 working days = Tue 2026-10-20
    expect(addWorkingDays(new Date('2026-10-15T03:00:00Z'), 3).toISOString()).toBe(
      '2026-10-20T03:00:00.000Z',
    );
    // Sat 2026-10-17 + 1 = Mon 2026-10-19
    expect(addWorkingDays(new Date('2026-10-17T03:00:00Z'), 1).toISOString()).toBe(
      '2026-10-19T03:00:00.000Z',
    );
    expect(addWorkingDays(new Date('2026-10-14T03:00:00Z'), 0).toISOString()).toBe(
      '2026-10-14T03:00:00.000Z',
    );
  });

  it('skips a fixed national holiday: Fri 14 Aug 2026 + 3 working days skips Mon 17 Aug', () => {
    // Fri 14 Aug -> Tue 18 (1), Wed 19 (2), Thu 20 (3); the 17th is Independence Day.
    expect(addWorkingDays(new Date('2026-08-14T03:00:00Z'), 3).toISOString()).toBe(
      '2026-08-20T03:00:00.000Z',
    );
  });

  it('counts the day in Jakarta: a request late Friday UTC is already Saturday in WIB', () => {
    // Fri 16 Oct 20:00 UTC = Sat 17 Oct 03:00 WIB. Sun 18 03:00 WIB is not a working day;
    // Mon 19 Oct 03:00 WIB (= Sun 18 Oct 20:00 UTC) is, so that is the first working day on.
    expect(addWorkingDays(new Date('2026-10-16T20:00:00Z'), 1).toISOString()).toBe(
      '2026-10-18T20:00:00.000Z',
    );
  });

  it('skips configured movable holidays too, and only those', () => {
    const extra = new Set(['2026-10-16']);
    // Thu 15 Oct + 3: Fri 16 is a holiday -> Mon 19 (1), Tue 20 (2), Wed 21 (3)
    expect(addWorkingDays(new Date('2026-10-15T03:00:00Z'), 3, extra).toISOString()).toBe(
      '2026-10-21T03:00:00.000Z',
    );
    expect(addWorkingDays(new Date('2026-10-15T03:00:00Z'), 3).toISOString()).toBe(
      '2026-10-20T03:00:00.000Z',
    );
  });
});
