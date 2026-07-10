import type { Order, Payment, PaymentMethod } from './types';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: 'CASH', label: 'Cash on delivery', hint: 'Pay the driver when your order arrives.' },
  { value: 'TRANSFER', label: 'Bank transfer', hint: 'Transfer manually, confirmed by the depot.' },
  { value: 'QRIS', label: 'QRIS', hint: 'Scan to pay with any QRIS app.' },
  { value: 'EWALLET', label: 'E-wallet', hint: 'GoPay, OVO, DANA, and more.' },
  { value: 'VA', label: 'Virtual account', hint: 'Pay to a one-time bank account number.' },
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
