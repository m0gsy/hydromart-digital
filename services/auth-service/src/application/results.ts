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
  /** Masked phone the code was sent to, e.g. "+62812****789". */
  phoneMasked: string;
  expiresInSeconds: number;
}
