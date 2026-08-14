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
