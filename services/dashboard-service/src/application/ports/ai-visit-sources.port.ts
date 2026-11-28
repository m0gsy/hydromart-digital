import { InstantRange } from './ai-money-sources.port';

/** depot-service `visits/internal/ai-summary`: one depot's visit counts. No visitor, note, photo or finding text. */
export interface VisitSummaryRow {
  depotId: string;
  /** COMPLETED visits whose completion is inside the window. */
  completed: number;
  /** FINDING lines of the completed visits checked in inside the window. */
  findings: number;
  /** WIB day (`YYYY-MM-DD`) of the newest completed visit of any time; null = never visited. */
  lastCompletedOn: string | null;
  /** Open follow-ups now, overdue ones included, and the overdue part. */
  followUpsOpen: number;
  followUpsOverdue: number;
}

/**
 * AI-21: the supervisor-visit facts the AI read API reads. `null` when depot-service cannot answer (down,
 * unwired, or a reply that is not exactly one row per depot asked), so a metric says belum_ada and never a partial sum.
 * At most 100 depots per call.
 */
export interface AiVisitSourcesPort {
  summary(depotIds: readonly string[], range: InstantRange): Promise<VisitSummaryRow[] | null>;
}
