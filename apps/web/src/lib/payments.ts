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
 * O5: keep only the methods this deployment can take.
 *
 * E-wallet and virtual account are the only ones that go through a gateway, and no gateway
 * is configured in production — so both were buttons that could only fail, after the
 * customer had already chosen how to pay. A missing answer (the read failed, or an older
 * gateway that does not carry the route) hides them too: a method that cannot be offered is
 * a smaller loss than one that cannot work, and the other three take every real payment
 * this business receives today.
 */
export function offeredMethods(available: Record<string, boolean> | null): typeof PAYMENT_METHODS {
  return PAYMENT_METHODS.filter((m) =>
    available ? available[m.value] === true : m.value !== 'EWALLET' && m.value !== 'VA',
  );
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
