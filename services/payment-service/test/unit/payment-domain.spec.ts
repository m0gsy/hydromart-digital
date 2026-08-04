import {
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
