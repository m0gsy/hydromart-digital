/**
 * Payment domain (PRD Module 5). Framework-free: the single source of truth for
 * which payment methods settle online and which status transitions are legal.
 */
export enum PaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  QRIS = 'QRIS',
  EWALLET = 'EWALLET',
  VA = 'VA',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

/** Methods settled through the payment gateway (need a charge + reference). */
const ONLINE_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.QRIS,
  PaymentMethod.EWALLET,
  PaymentMethod.VA,
];

export function isOnlineMethod(method: PaymentMethod): boolean {
  return ONLINE_METHODS.includes(method);
}

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.CANCELLED]: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isRefundable(status: PaymentStatus): boolean {
  return canTransition(status, PaymentStatus.REFUNDED);
}
