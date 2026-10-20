import { endpoints } from './endpoints';
import { can, isDepotResolvedRole } from './roles';

/**
 * The courier-roster URL for the depot view a console screen is showing.
 *
 * auth-service refuses `GET /auth/drivers` with 403 for a MANAGER (or a SUPERVISOR, or an
 * ASSISTANT_SUPERVISOR) who covers several depots and names none — returning every depot's couriers would widen the read past their scope — so a
 * screen that asked without a depot broke dispatch for exactly the managers who run more than
 * one. A selected depot is always named. Such a role on "all depots" is pinned to the first depot
 * in scope; head-office roles keep the network-wide roster, which they are allowed to read.
 */
export function driversUrl(view: {
  selectedId: string | null;
  scopedId: string | null;
  role?: string;
}): string {
  const id = view.selectedId ?? (isDepotResolvedRole(view.role) ? view.scopedId : null);
  return id ? endpoints.auth.driversAt(id) : endpoints.auth.drivers;
}

/**
 * Runs `load` once the roster URL is known. While it is not (`null`) the promise stays pending,
 * so the screen keeps its loading state instead of firing a roster read the server would refuse,
 * or flashing "no couriers" for a list that simply has not been asked for yet.
 */
export function whenRosterScoped<T>(
  url: string | null,
  load: (url: string) => Promise<T>,
): Promise<T> {
  return url === null ? new Promise<T>(() => undefined) : load(url);
}

/**
 * Whether this role may call `GET /auth/drivers` at all.
 *
 * The roster is a capability of its own (`driverRosterRead`), narrower than the screens that
 * happen to show a courier list: the order queue is open to depot staff and both supervisor
 * roles, none of whom hold it. Those screens asked anyway, got a 403 for every visitor in
 * those roles, and drew it as a failed panel — an error nobody could ever clear. A screen that
 * needs the roster asks this first and shows the part that does not depend on it.
 */
export function canReadRoster(role: string | null | undefined): boolean {
  return can('driverRosterRead', role);
}
