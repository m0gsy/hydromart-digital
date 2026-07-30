import type { StaffImportRole } from '@hydromart/access';

export const IDENTITY_PORT = Symbol('IdentityPort');

/**
 * Roles a bulk employee import may provision. Aliased straight to the allowlist in
 * @hydromart/access rather than hand-mirrored — a second copy is how the two drifted
 * apart before.
 */
export type StaffRole = StaffImportRole;

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
