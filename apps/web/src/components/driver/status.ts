import type { DeliveryStatus, Payment } from '@/lib/types';

/**
 * C1(c): does this delivery still owe cash at the door?
 *
 * `codAmount` alone does not answer it — it is written at assignment and never cleared,
 * so a confirmed COD still carries it. The payment book is the other half.
 *
 * Only CASH+PENDING counts. A refunded or cancelled row is not money the courier is
 * about to be handed, and a PAID one is money already recorded.
 */
export function codOutstanding(
  codAmount: number | null | undefined,
  payments: Payment[],
): boolean {
  if (!codAmount) return false;
  return payments.some((p) => p.method === 'CASH' && p.status === 'PENDING');
}

/**
 * Dictionary KEYS for the courier-facing delivery lifecycle (shared by list + detail).
 *
 * These were six Indonesian strings in an enum-keyed object, which is one of the shapes
 * `check-i18n.mjs` could not read — so the six words a courier sees on every job, all day,
 * were the only part of that screen that never reached a translator.
 */
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  ASSIGNED: 'courierFix.deliveryStatus.ASSIGNED',
  PICKED_UP: 'courierFix.deliveryStatus.PICKED_UP',
  ON_DELIVERY: 'courierFix.deliveryStatus.ON_DELIVERY',
  DELIVERED: 'courierFix.deliveryStatus.DELIVERED',
  FAILED: 'courierFix.deliveryStatus.FAILED',
  RESCHEDULED: 'courierFix.deliveryStatus.RESCHEDULED',
};

type BadgeTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning';

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, BadgeTone> = {
  ASSIGNED: 'neutral',
  PICKED_UP: 'brand',
  ON_DELIVERY: 'warning',
  DELIVERED: 'success',
  FAILED: 'danger',
  RESCHEDULED: 'warning',
};
