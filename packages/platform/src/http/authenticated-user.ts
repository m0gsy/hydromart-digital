import { Role } from '../domain/role.enum';

/** Identity attached to a request after a valid access token is verified. */
export interface AuthenticatedUser {
  sub: string;
  role: Role;
  phone: string;
}

/** Caller metadata for audit logs and records. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}
