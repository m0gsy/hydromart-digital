import { Role } from '../../domain/customer/role.enum';

/** Shape attached to the request after a valid access token is verified. */
export interface AuthenticatedUser {
  sub: string;
  role: Role;
  phone: string;
  /**
   * Depots this caller may touch, filled in by the platform DepotScopeGuard (registered in
   * auth.module) for the depot-scoped roles. Mirrors @hydromart/platform's field of the
   * same name: `undefined` = the guard did not run, `[]` = scoped to nothing — opposite
   * answers, never conflate them.
   */
  depotIds?: readonly string[];
  /**
   * The caller's home depot, as signed into the access token (`session.service.ts`).
   * Every other service carries this through; auth-service dropped it when rebuilding
   * `request.user`, which left its own DepotScopeGuard half dead — `own` resolved to `[]`
   * for every caller, so a depot-locked role sending `?depotId=` was always refused.
   */
  depotId?: string | null;
}
