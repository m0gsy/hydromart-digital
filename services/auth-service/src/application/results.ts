import { Customer } from '../domain/customer/customer.entity';
import { CustomerStatus } from '../domain/customer/customer-status.enum';
import { Role } from '../domain/customer/role.enum';

/** Metadata about the caller, threaded into audit logs and refresh-token records. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Safe, outward-facing view of an account (never exposes secrets). */
export interface PublicCustomer {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  status: CustomerStatus;
  avatarUrl: string | null;
  assignedDepotId: string | null;
  vehicleType: string | null;
  plateNumber: string | null;
  createdAt: Date;
}

export function toPublicCustomer(customer: Customer): PublicCustomer {
  return {
    id: customer.id,
    phone: customer.phone,
    email: customer.email,
    fullName: customer.fullName,
    role: customer.role,
    status: customer.status,
    avatarUrl: customer.avatarUrl,
    assignedDepotId: customer.assignedDepotId,
    vehicleType: customer.vehicleType,
    plateNumber: customer.plateNumber,
    createdAt: customer.createdAt,
  };
}

/** Result of issuing a session (access + refresh tokens). */
export interface SessionResult {
  tokenType: 'Bearer';
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  customer: PublicCustomer;
}

/** Result of issuing an OTP challenge (no secret returned to the client). */
export interface OtpChallengeResult {
  /*
   * True when the SMS gateway did not answer in time and the code may still be on its
   * way. The challenge is valid either way — it is stored before the send — so the
   * customer goes to the code screen rather than into a dead end, and the screen can
   * say "this one is taking a moment" instead of pretending everything was instant.
   */
  deliveryPending?: boolean;
  /** Masked phone the code was sent to, e.g. "+62812****789". */
  phoneMasked: string;
  expiresInSeconds: number;
  /**
   * E4: how long this service will refuse another code for this challenge. Stated rather
   * than assumed, because the client used to hold its own copy of the number and the two
   * disagreed — the screen counted 30 seconds, the server enforced 60, and the first
   * honest "resend" was answered with a 429 nobody had done anything to earn.
   */
  resendCooldownSeconds: number;
}
