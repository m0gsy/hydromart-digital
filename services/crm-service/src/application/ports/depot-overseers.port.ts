/**
 * Who oversees a depot: its assistant supervisor and everyone above them in the reporting
 * line, as account ids. The depot's own staff come from `DepotStaffPort`; this is the people
 * ABOVE it, who answer for it without being rostered to it.
 *
 * THROWS when it cannot find out, so the caller can tell "no overseers" from "could not ask"
 * and say so. An unconfigured service is a plain empty list (the deployment never wired it).
 */
export interface DepotOverseersPort {
  overseersOfDepot(depotId: string): Promise<string[]>;
}
