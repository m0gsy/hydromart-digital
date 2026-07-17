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
 */
export function isAutoApproved(amount: number, threshold: number): boolean {
  return threshold > 0 && amount <= threshold;
}
