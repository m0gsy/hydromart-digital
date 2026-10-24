import type { Grouping, InsightRange } from '@/lib/insight/range';

/** What every tab is told about the window and the depot in view. */
export interface InsightCtx {
  role: string | null | undefined;
  range: InsightRange;
  /** The window right before `range`, and the same window a year earlier. */
  prev: InsightRange;
  year: InsightRange;
  /** The window is still running, so `prev` and `year` were cut to the same number of days. */
  partial: boolean;
  /** False when there is nothing honest to compare with yet (a day that has not ended). */
  comparable: boolean;
  grouping: Grouping;
  /**
   * The depot the report is narrowed to, or undefined for "everything this role reaches" (the
   * server narrows a depot-scoped caller on its own either way).
   */
  depotIds: readonly string[] | undefined;
  /** A single depot, chosen or the only one in reach: what a per-depot figure needs. */
  depotId: string | null;
}
