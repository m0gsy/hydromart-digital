/**
 * When a depot last asked a customer to bring its gallons back.
 *
 * The reminder sweep runs every morning; without this record it would send an overdue
 * customer the same message every morning. One row per (depot, customer), overwritten on each
 * reminder — it answers "when did we last ask?", nothing more.
 */
export interface GallonReminderRepository {
  /** When each of these customers was last reminded at this depot. Absent = never. */
  lastRemindedAt(depotId: string, customerIds: readonly string[]): Promise<Map<string, Date>>;
  markReminded(depotId: string, customerId: string, at: Date): Promise<void>;
}
