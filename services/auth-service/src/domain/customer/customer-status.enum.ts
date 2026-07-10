/** Lifecycle states of an account. Mirrors the Prisma `CustomerStatus` enum. */
export enum CustomerStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}
