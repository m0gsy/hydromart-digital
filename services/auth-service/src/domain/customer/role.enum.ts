/**
 * Account roles used for RBAC across Hydromart services (PRD §26).
 * String values are kept identical to the Prisma `Role` enum so persistence
 * mapping is a straight cast at the repository boundary.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  STAFF_DEPOT = 'STAFF_DEPOT',
  KEPALA_DEPOT = 'KEPALA_DEPOT',
  ASSISTANT_SUPERVISOR = 'ASSISTANT_SUPERVISOR',
  SUPERVISOR = 'SUPERVISOR',
  MANAGER = 'MANAGER',
  DIREKTUR = 'DIREKTUR',
  FRANCHISE_OWNER = 'FRANCHISE_OWNER',
  HEAD_OFFICE = 'HEAD_OFFICE',
  FINANCE = 'FINANCE',
  HR = 'HR',
  MARKETING = 'MARKETING',
  SUPER_ADMIN = 'SUPER_ADMIN',
}
