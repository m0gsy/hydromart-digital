/**
 * Account roles used for RBAC across Hydromart services (PRD §26).
 * String values are kept identical to the Prisma `Role` enum so persistence
 * mapping is a straight cast at the repository boundary.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  DRIVER = 'DRIVER',
  DEPOT_OPERATOR = 'DEPOT_OPERATOR',
  DEPOT_MANAGER = 'DEPOT_MANAGER',
  FRANCHISE_OWNER = 'FRANCHISE_OWNER',
  HEAD_OFFICE = 'HEAD_OFFICE',
  FINANCE = 'FINANCE',
  MARKETING = 'MARKETING',
  SUPER_ADMIN = 'SUPER_ADMIN',
}
