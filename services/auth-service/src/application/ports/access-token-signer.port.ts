import { Role } from '../../domain/customer/role.enum';

/** Claims embedded in a signed access token. */
export interface AccessTokenClaims {
  /** Subject — the customer id. */
  sub: string;
  role: Role;
  phone: string;
  /** Depot this staff account is assigned to (design: depot tenant isolation). Null for
   * customers, HQ/finance/marketing, and unassigned accounts. Depot operators/managers are
   * locked to this depot server-side by the platform DepotScopeGuard. */
  depotId?: string | null;
}

export interface SignedAccessToken {
  token: string;
  /** Lifetime in seconds. */
  expiresIn: number;
}

/** Port for issuing signed JWT access tokens (implemented with @nestjs/jwt). */
export interface AccessTokenSignerPort {
  sign(claims: AccessTokenClaims): Promise<SignedAccessToken>;
}
