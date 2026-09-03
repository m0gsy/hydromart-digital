export const HIERARCHY_REPOSITORY = Symbol('HierarchyRepository');

/**
 * The supervision hierarchy: which depots belong to which assistant supervisor, who
 * reports to whom, and any depots granted to someone directly.
 *
 * Every id is an auth-service account id (uuid), crossing a service boundary with no FK —
 * the same convention `Depot.ownerId` already uses.
 */
export interface HierarchyRepository {
  /** Depots whose assistant supervisor is `staffId`. */
  depotsForAssistant(staffId: string): Promise<string[]>;
  /** Direct reports of `superiorId` (assistants under a supervisor, supervisors under a manager). */
  subordinatesOf(superiorId: string): Promise<string[]>;
  /** Depots whose assistant supervisor is any of `staffIds` (one query, not N). */
  depotsForAssistants(staffIds: readonly string[]): Promise<string[]>;
  /** Direct reports of any of `superiorIds` (one query, not N). */
  subordinatesOfMany(superiorIds: readonly string[]): Promise<string[]>;
  /** Depots granted to `staffId` outside the hierarchy walk. */
  directDepots(staffId: string): Promise<string[]>;

  /** Put a depot under an assistant supervisor, or clear it with null. */
  setDepotAssistant(
    depotId: string,
    staffId: string | null,
    updatedBy: string | null,
  ): Promise<void>;
  /** Point a person at their superior, replacing any existing link. */
  setSuperior(staffId: string, superiorId: string, updatedBy: string | null): Promise<void>;
  /** Remove a person's superior link. */
  clearSuperior(staffId: string): Promise<void>;
  /** Grant one depot to a person directly. */
  grantDepot(staffId: string, depotId: string, updatedBy: string | null): Promise<void>;
  /** Revoke a direct grant. */
  revokeDepot(staffId: string, depotId: string): Promise<void>;
  /**
   * Just the superior link, for the cycle walk (D-14).
   *
   * `describe()` fires four queries and the walk discarded three of them at every hop, so
   * attaching somebody eight levels down cost 32 queries to answer one question about one
   * column.
   */
  superiorOf(staffId: string): Promise<string | null>;
  /** Everything recorded for one person, for the admin screen. */
  describe(staffId: string): Promise<{
    superiorId: string | null;
    subordinateIds: string[];
    assistantDepotIds: string[];
    directDepotIds: string[];
  }>;
}
