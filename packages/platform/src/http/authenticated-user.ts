import { Role } from '../domain/role.enum';

/** Identity attached to a request after a valid access token is verified. */
export interface AuthenticatedUser {
  sub: string;
  role: Role;
  /** Null for the internal system principal (service-to-service calls have no phone). */
  phone: string | null;
  /** Depot the account is assigned to, from the access token. Non-null only for depot staff
   * (operator/manager). The DepotScopeGuard uses it to keep those roles inside their own
   * depot; null/absent for customers, HQ roles, and the system principal. */
  depotId?: string | null;
  /**
   * Depots this caller may touch, resolved ONCE per request by DepotScopeGuard.
   *
   * Single-depot roles: `[depotId]`. Multi-depot roles (the supervision chain and
   * franchise owners): the resolved set, possibly empty. `undefined` means unscoped — HQ,
   * finance, marketing, direktur, super admin and the system principal see every depot,
   * and must not be confused with an empty array, which sees none.
   *
   * Resolved in the guard so everything downstream stays a synchronous pure function.
   */
  depotIds?: readonly string[];
  /**
   * HD-2: set only for an ES256 token. `ai` is a person acting through the AI web (their own
   * role and capabilities apply); `machine` is a machine account, which holds no role of its
   * own and may use exactly the capabilities listed in `scopes`. Absent for every other caller.
   */
  via?: 'ai' | 'machine';
  /** The closed capability list of a machine account. Never set for anyone else. */
  scopes?: readonly string[];
}

/** Caller metadata for audit logs and records. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}
