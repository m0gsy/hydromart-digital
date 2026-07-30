import { capabilityMatrixStatus, type CapabilityMatrixStatus } from './capability-refresh';
import { depotScopeStatus, type DepotScopeStatus } from './depot-scope-resolver';

export interface RbacHealth {
  capabilityMatrix: CapabilityMatrixStatus;
  depotScope: DepotScopeStatus;
}

/**
 * The two pieces of RBAC wiring that fail SILENTLY when a service's bootstrap misses a
 * line: the capability refresher (that service serves compiled defaults forever) and the
 * depot-scope resolver (every supervisor there is narrowed to one depot). Neither throws,
 * neither logs after boot, and both look exactly like correct behaviour from outside.
 *
 * Spread into a health controller's `checks` so the whole fleet is one dashboard query:
 * `capabilityMatrix.overrides: null` or `depotScope.configured: false` on any single
 * service is the tell.
 *
 * Deliberately NOT part of the health STATUS: neither is an outage. A service serving the
 * compiled matrix is serving the policy in its own binary, and 503-ing the fleet over an
 * observability gap would be a far worse trade than reporting it.
 */
export function rbacHealth(): RbacHealth {
  return { capabilityMatrix: capabilityMatrixStatus(), depotScope: depotScopeStatus() };
}
