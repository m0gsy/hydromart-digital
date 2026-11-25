/** One stretch of a period during which a depot belonged to one legal entity (null: none recorded yet). */
export interface DepotEntitySpan {
  depotId: string;
  legalEntityId: string | null;
  /** First day of the stretch inside the period, `YYYY-MM-DD`. */
  from: string;
}

/** What a role may read in the AI web: every entity (`all`), or exactly these. */
export interface AiGrants {
  all: boolean;
  legalEntityIds: string[];
}

/**
 * HD-6: the legal-entity facts the AI read API narrows its scope with, from depot-service. Both
 * answer null when depot-service cannot: the caller then fails closed, never "no narrowing".
 */
export interface AiReadSourcesPort {
  /** Each depot's legal entity over `[from, to]` (calendar days), the W-06 rule. */
  entityTimeline(depotIds: readonly string[], from: string, to: string): Promise<DepotEntitySpan[] | null>;
  /** HD-16 PR-B: the registered name of one legal entity, or null when it cannot be read. */
  entityName(legalEntityId: string): Promise<string | null>;
  /** The legal entities this role key is granted in the AI web. */
  aiGrants(roleKey: string): Promise<AiGrants | null>;
}
