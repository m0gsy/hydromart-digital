export const IDENTITY_PORT = Symbol('IdentityPort');

/** Roles a bulk employee import may provision — mirrors STAFF_IMPORT_ROLES in @hydromart/access. */
export type StaffRole =
  'DEPOT_OPERATOR' | 'DEPOT_MANAGER' | 'DRIVER' | 'FINANCE' | 'HR' | 'MARKETING';

export interface ProvisionStaffInput {
  phone: string;
  role: StaffRole;
  fullName?: string;
  depotId?: string;
}

/**
 * Creates (or promotes) the login account behind an employee record, so an imported
 * employee can clock in by phone OTP straight away.
 *
 * Fails HARD, unlike the fail-soft SalesPort: an employee row without its account is a
 * person who cannot clock in, and nothing downstream would notice. The import reports
 * that row as failed instead.
 */
export interface IdentityPort {
  provisionStaff(input: ProvisionStaffInput): Promise<{ customerId: string }>;
}
