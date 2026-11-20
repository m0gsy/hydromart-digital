import type { HrManagedRole, StaffImportRole } from '@hydromart/access';
import { DomainError, HTTP_STATUS } from '@hydromart/platform';

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
  /**
   * SEC-AUDIT CORE-1. Role of the person making this change. `hrAdmin` is held by head office
   * as well as HR and only HR may promote to MANAGER, so auth-service needs to know which of
   * the two is asking. Omitted = an anonymous call, which may grant no restricted role.
   */
  grantedBy?: string;
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
  /**
   * HR confirmed closing the never-used customer account that holds the new number. Without
   * it auth-service refuses, and the port raises UnusedCustomerOnPhoneError naming the account.
   */
  closeUnusedCustomer?: boolean;
}

/**
 * The new number belongs to a customer account that was never used — almost always the
 * employee themselves, signed up on their real number because HR had a wrong one. Closing it
 * is HR's to confirm (owner decision 2026-11-20), because a mistyped number would otherwise
 * close a stranger's account and hand them the staff login. The message names the account so
 * HR can tell their employee from a typo; the form resends with `confirmCloseCustomer`.
 */
export class UnusedCustomerOnPhoneError extends DomainError {
  readonly code = 'HR_PHONE_UNUSED_CUSTOMER';
  readonly status = HTTP_STATUS.CONFLICT;
  constructor(customerName: string | null, createdAt: string | null) {
    const when = createdAt ? formatDay(createdAt) : null;
    const who = customerName?.trim() ? `atas nama ${customerName.trim()}` : 'tanpa nama';
    super(
      `Nomor HP ini dipakai akun pelanggan ${who}${when ? ` (dibuat ${when})` : ''} yang belum pernah dipakai: tanpa pesanan, langganan, atau poin. Kalau itu memang karyawan ini, tutup akun pelanggan itu dan pindahkan nomornya ke sini. Kalau bukan, nomornya salah ketik.`,
    );
  }
}

/** "18 November 2026", as a person in the business's time zone reads the day. */
function formatDay(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(at);
}

export interface AssignRoleInput {
  /** auth-service Customer.id (the employee's `authSubjectId`). */
  customerId: string;
  role: HrManagedRole;
  /** Omit to leave the account's depot alone; null clears it (staff above one depot). */
  depotId?: string | null;
  /**
   * SEC-AUDIT CORE-1. Role of the person making this change. `hrAdmin` is held by head office
   * as well as HR and only HR may promote to MANAGER, so auth-service needs to know which of
   * the two is asking. Omitted = an anonymous call, which may grant no restricted role.
   */
  grantedBy?: string;
}
