import type { Order, Payment, PaymentMethod } from './types';

/**
 * Dictionary KEYS, not copy. This was five English labels that no toggle could change, on
 * the checkout screen of an Indonesian app — a module-level constant cannot call a hook,
 * so the keys resolve at the two call sites (checkout, order detail).
 */
export const PAYMENT_METHODS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: 'CASH', label: 'order.payMethod.cash', hint: 'order.payMethod.cashHint' },
  { value: 'TRANSFER', label: 'order.payMethod.transfer', hint: 'order.payMethod.transferHint' },
  { value: 'QRIS', label: 'order.payMethod.qris', hint: 'order.payMethod.qrisHint' },
  { value: 'EWALLET', label: 'order.payMethod.ewallet', hint: 'order.payMethod.ewalletHint' },
  { value: 'VA', label: 'order.payMethod.va', hint: 'order.payMethod.vaHint' },
];

/**
 * What a depot needs before it can be paid directly. Both are nullable in the schema and
 * both are blank on every production depot today, which is the whole point.
 */
export type DepotPaymentDestination = {
  /*
   * Two shapes, because there genuinely are two. The anonymous `/depots/nearby` answers in
   * booleans on purpose — publishing account numbers there is a leak the depot DTO records
   * closing — while the signed-in payment panel and the admin depot list carry the details
   * themselves. Booleans win where both arrive; either alone is enough to decide.
   */
  acceptsTransfer?: boolean;
  acceptsQris?: boolean;
  paymentBankAccountNumber?: string | null;
  paymentQrisImageUrl?: string | null;
};

/** A field of spaces is not a bank account: nobody can transfer to it. */
const filled = (v: string | null | undefined): boolean => (v ?? '').trim().length > 0;

/**
 * O5: keep only the methods this deployment can take.
 *
 * E-wallet and virtual account are the only ones that go through a gateway, and no gateway
 * is configured in production — so both were buttons that could only fail, after the
 * customer had already chosen how to pay. A missing answer (the read failed, or an older
 * gateway that does not carry the route) hides them too: a method that cannot be offered is
 * a smaller loss than one that cannot work, and the other three take every real payment
 * this business receives today.
 *
 * L2.3 extends exactly that rule to the two methods O5 left alone, because they turned out
 * to have the same failure for a different reason. Payment is direct-to-depot: a transfer
 * goes to the fulfilling depot's own bank account and a QRIS is that depot's own printed
 * code. The server's answer cannot know either — it is about the platform, and it says
 * TRANSFER and QRIS with a hardcoded `true`. Asked on 2026-08-26, production had three
 * active depots and not one bank account or QRIS image among them, so both buttons were
 * offered to everyone and both ended in an order nobody could pay.
 *
 * CASH is never filtered, so there is always a way left to pay.
 */
export function offeredMethods(
  available: Record<string, boolean> | null,
  depot?: DepotPaymentDestination | null,
): typeof PAYMENT_METHODS {
  const platformTakes = (m: (typeof PAYMENT_METHODS)[number]) =>
    available ? available[m.value] === true : m.value !== 'EWALLET' && m.value !== 'VA';

  // A depot we have not loaded yet holds no opinion: filtering on it would strip two
  // working methods for as long as the fetch is in flight.
  const depotTakes = (m: (typeof PAYMENT_METHODS)[number]) => {
    if (!depot) return true;
    if (m.value === 'TRANSFER') return depot.acceptsTransfer ?? filled(depot.paymentBankAccountNumber);
    if (m.value === 'QRIS') return depot.acceptsQris ?? filled(depot.paymentQrisImageUrl);
    return true;
  };

  return PAYMENT_METHODS.filter((m) => platformTakes(m) && depotTakes(m));
}

/**
 * Whether an order still needs a payment initiated. True when the order is not
 * cancelled and there is no active (PENDING/PAID) payment — i.e. no payment yet,
 * or the last attempt FAILED/was CANCELLED. payment-service also enforces the
 * one-active-payment-per-order rule server-side.
 */
export function needsPayment(order: Pick<Order, 'status'>, payment: Payment | undefined): boolean {
  if (order.status === 'CANCELLED') return false;
  if (payment && (payment.status === 'PENDING' || payment.status === 'PAID')) return false;
  return true;
}
