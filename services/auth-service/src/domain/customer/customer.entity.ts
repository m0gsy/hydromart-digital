import { AccountNotActiveError, AccountPendingVerificationError } from '../errors/auth.errors';
import { CustomerStatus } from './customer-status.enum';
import { Role } from './role.enum';

export interface CustomerProps {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  status: CustomerStatus;
  googleSub: string | null;
  avatarUrl: string | null;
  assignedDepotId: string | null;
  vehicleType: string | null;
  plateNumber: string | null;
  phoneVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Identity aggregate. Encapsulates the account lifecycle invariants used by the
 * authentication use-cases. State-changing methods mutate in place; the repository
 * persists the resulting props.
 */
export class Customer {
  private constructor(private props: CustomerProps) {}

  /** Reconstitute an entity from persisted state. */
  static fromPersistence(props: CustomerProps): Customer {
    return new Customer(props);
  }

  get id(): string {
    return this.props.id;
  }
  get phone(): string {
    return this.props.phone;
  }
  get email(): string | null {
    return this.props.email;
  }
  get fullName(): string | null {
    return this.props.fullName;
  }
  get role(): Role {
    return this.props.role;
  }
  get status(): CustomerStatus {
    return this.props.status;
  }
  get googleSub(): string | null {
    return this.props.googleSub;
  }
  get avatarUrl(): string | null {
    return this.props.avatarUrl;
  }
  get assignedDepotId(): string | null {
    return this.props.assignedDepotId;
  }
  get vehicleType(): string | null {
    return this.props.vehicleType;
  }
  get plateNumber(): string | null {
    return this.props.plateNumber;
  }
  get phoneVerifiedAt(): Date | null {
    return this.props.phoneVerifiedAt;
  }
  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  isPendingVerification(): boolean {
    return this.props.status === CustomerStatus.PENDING_VERIFICATION;
  }

  isActive(): boolean {
    return this.props.status === CustomerStatus.ACTIVE;
  }

  /**
   * Guard used before issuing a session. A suspended or deleted account may never
   * authenticate; a pending account must verify its phone first.
   */
  ensureCanAuthenticate(): void {
    switch (this.props.status) {
      case CustomerStatus.ACTIVE:
        return;
      case CustomerStatus.PENDING_VERIFICATION:
        // CA-3-05: its own code, because the answer is a new OTP rather than a support
        // ticket. The other two branches keep `AccountNotActiveError` — those DO need a
        // human, and flattening all three into one code is what sent this one to support.
        throw new AccountPendingVerificationError();
      case CustomerStatus.SUSPENDED:
        throw new AccountNotActiveError('This account has been suspended.');
      case CustomerStatus.DELETED:
        throw new AccountNotActiveError('This account no longer exists.');
    }
  }

  /** Activate a pending account once its phone OTP is verified (FR-003). */
  markPhoneVerified(now: Date): void {
    if (this.props.status === CustomerStatus.PENDING_VERIFICATION) {
      this.props.status = CustomerStatus.ACTIVE;
    }
    this.props.phoneVerifiedAt = this.props.phoneVerifiedAt ?? now;
  }

  /**
   * Self-service profile update (FR-009). `undefined` leaves a field untouched;
   * an explicit value (incl. `null` to clear email) replaces it.
   */
  updateProfile(fullName?: string | null, email?: string | null): void {
    if (fullName !== undefined) {
      this.props.fullName = fullName;
    }
    if (email !== undefined) {
      this.props.email = email;
    }
  }

  /**
   * Move this account to another phone number — the login identity itself.
   *
   * HR owns an employee's contact details, and until now a correction there never reached
   * here: the directory showed the new number while the OTP still went to the old one.
   * `phoneVerifiedAt` is deliberately left alone for the same reason an invite activates
   * immediately — staff are pre-trusted, and clearing it would lock out somebody whose
   * number was fixed on their behalf.
   */
  changePhone(phone: string): void {
    this.props.phone = phone;
  }

  /**
   * Admin action (staff & roles, PRD Module 7): assign a staff role to this account.
   * An invited/promoted staff member is pre-trusted, so a still-pending account is
   * activated immediately (they sign in by phone OTP; no self-verification needed).
   *
   * SUSPENDED is lifted too: that is the status a resignation writes, so re-hiring
   * someone would otherwise leave them locked out with nothing on screen to explain it.
   * DELETED is NOT lifted — that account's identity has been anonymised, so "hire again"
   * has to mint a new one rather than resurrect a record nobody can read back.
   */
  promoteToStaff(role: Role, depotId?: string | null): void {
    this.props.role = role;
    if (depotId !== undefined) {
      this.props.assignedDepotId = depotId;
    }
    if (
      this.props.status === CustomerStatus.PENDING_VERIFICATION ||
      this.props.status === CustomerStatus.SUSPENDED
    ) {
      this.props.status = CustomerStatus.ACTIVE;
    }
  }

  /** Link a Google identity to this account (FR-006). */
  linkGoogle(googleSub: string, email: string | null, fullName: string | null): void {
    this.props.googleSub = googleSub;
    if (!this.props.email && email) {
      this.props.email = email;
    }
    if (!this.props.fullName && fullName) {
      this.props.fullName = fullName;
    }
  }

  recordLogin(now: Date): void {
    this.props.lastLoginAt = now;
  }

  /** Set the customer's avatar to a freshly uploaded image URL (FR-009). */
  setAvatar(url: string): void {
    this.props.avatarUrl = url;
  }

  /**
   * Set STAFF_DEPOT vehicle info (staff invite/promote form). `undefined` leaves a field
   * untouched; `null` clears it. Free-text type (e.g. "MOTOR"/"MOBIL") + plate number.
   */
  setVehicle(vehicleType?: string | null, plateNumber?: string | null): void {
    if (vehicleType !== undefined) {
      this.props.vehicleType = vehicleType;
    }
    if (plateNumber !== undefined) {
      this.props.plateNumber = plateNumber;
    }
  }

  /**
   * Move a staff account to another depot, and nothing else.
   *
   * Deliberately not `promoteToStaff(sameRole, depot)`: that one activates a suspended
   * account, and a transfer must never be a way to quietly hand somebody their login back.
   */
  assignDepot(depotId: string | null): void {
    this.props.assignedDepotId = depotId;
  }

  /**
   * Change a staff account's role (and optionally its depot), and nothing else.
   *
   * B-1. `assignDepot` above was given its own path precisely so a transfer could not hand
   * somebody their login back — but the role path was still `promoteToStaff`, which lifts
   * SUSPENDED to ACTIVE. hr-service calls it on `roleMoved || depotMoved`, so editing a
   * RESIGNED employee's DEPOT alone reactivated their login while HR still said RESIGNED.
   *
   * Reactivation belongs to the two places that mean it: the invite (`promoteToStaff`,
   * where being invited is the point) and `setActive`.
   */
  assignRole(role: Role, depotId?: string | null): void {
    this.props.role = role;
    if (depotId !== undefined) {
      this.props.assignedDepotId = depotId;
    }
  }

  /**
   * Switch the login on or off, and nothing else.
   *
   * Its own path rather than `promoteToStaff`, which also writes role and depot: turning
   * somebody off when they resign must not quietly re-role them, and turning them back on
   * must not resurrect a depot they no longer work at.
   *
   * DELETED is never revived here — that identity has been anonymised, so "activate" would
   * bring back an account nobody can read back. Re-hiring mints a new one.
   */
  /**
   * Soft delete: the account can never sign in again and is filtered out of the staff
   * directory. Irreversible on purpose — `setActive` and `promoteToStaff` both refuse to
   * lift DELETED, because by the time this is called the identity has been anonymised and
   * there is nothing left to bring back.
   */
  markDeleted(): void {
    this.props.status = CustomerStatus.DELETED;
  }

  setActive(active: boolean): void {
    if (this.props.status === CustomerStatus.DELETED) {
      return;
    }
    this.props.status = active ? CustomerStatus.ACTIVE : CustomerStatus.SUSPENDED;
  }

  /** Snapshot for persistence mapping. */
  toProps(): CustomerProps {
    return { ...this.props };
  }
}
