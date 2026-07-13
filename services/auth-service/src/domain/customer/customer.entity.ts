import { AccountNotActiveError } from '../errors/auth.errors';
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
        throw new AccountNotActiveError('Please verify your phone number first.');
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
   * Admin action (staff & roles, PRD Module 7): assign a staff role to this account.
   * An invited/promoted staff member is pre-trusted, so a still-pending account is
   * activated immediately (they sign in by phone OTP; no self-verification needed).
   */
  promoteToStaff(role: Role): void {
    this.props.role = role;
    if (this.props.status === CustomerStatus.PENDING_VERIFICATION) {
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

  /** Snapshot for persistence mapping. */
  toProps(): CustomerProps {
    return { ...this.props };
  }
}
