/**
 * Courier expense claims (design 6a). Framework-free. The reimbursement rule lives here:
 * a claim at or under the depot's auto-approve threshold clears without a reviewer.
 */

export type ExpenseCategory = 'FUEL' | 'PARKING_TOLL' | 'VEHICLE_REPAIR' | 'OTHER';

export type ExpenseClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Whether a claim auto-approves. A non-positive threshold disables auto-approve (every
 * claim needs a reviewer). ponytail: flat per-service threshold; make it per-depot only
 * if depots ever need different limits.
 *
 * M20-15: a receipt is required as well. Money leaving the company on nothing but a
 * courier's own say-so is exactly what a reviewer exists to catch, so a claim with no
 * receipt always queues no matter how small it is.
 */
export function isAutoApproved(amount: number, threshold: number, hasReceipt: boolean): boolean {
  return hasReceipt && threshold > 0 && amount <= threshold;
}
