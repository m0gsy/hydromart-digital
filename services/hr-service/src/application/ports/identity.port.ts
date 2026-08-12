import type { HrManagedRole, StaffImportRole } from '@hydromart/access';

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
 * The single-employee form's version. Same call, one rung wider allowlist: a human typing
 * one name may mint a supervisor, a thousand-row file may not (see ProvisionStaffInput).
 */
export interface ProvisionManagedStaffInput {
  phone: string;
  role: HrManagedRole;
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

  /** Provision for the HR form rather than an import file. Fails hard for the same reason. */
  provisionManagedStaff(input: ProvisionManagedStaffInput): Promise<{ customerId: string }>;

  /**
   * Push a jabatan change onto the existing login.
   *
   * Also fails hard: an employee whose title says SPV while their token still says
   * assistant is worse than a rejected edit — nobody would notice until they were denied
   * something, or allowed something they should no longer reach.
   */
  assignRole(input: AssignRoleInput): Promise<void>;

  /**
   * Switch the login off when somebody resigns or is made inactive, and back on when they
   * return. Called ONLY from the HR-side write; the endpoint auth-service calls in the
   * other direction writes without notifying, or the two would bounce the same change
   * between themselves forever.
   */
  setStaffActive(customerId: string, active: boolean): Promise<void>;

  /**
   * Push a corrected name or phone number onto the existing login.
   *
   * Fails hard like the other two. A name that only ever changed here left the HQ staff
   * directory showing the old one forever; a phone that only ever changed here was worse —
   * HR displayed the new number while the OTP kept going to the old one, and nothing
   * anywhere said the two disagreed.
   */
  updateStaffProfile(input: UpdateStaffProfileInput): Promise<void>;
}

export interface UpdateStaffProfileInput {
  /** auth-service Customer.id (the employee's `authSubjectId`). */
  customerId: string;
  /** Omit to leave it alone. */
  fullName?: string;
  /** The login number itself. Omit to leave it alone. */
  phone?: string;
}

export interface AssignRoleInput {
  /** auth-service Customer.id (the employee's `authSubjectId`). */
  customerId: string;
  role: HrManagedRole;
  /** Omit to leave the account's depot alone; null clears it (staff above one depot). */
  depotId?: string | null;
}
