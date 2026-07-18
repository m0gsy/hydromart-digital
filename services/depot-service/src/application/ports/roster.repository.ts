import { ShiftAssignment, ShiftKind } from '../../domain/shift';

/** The identifying + value fields for one roster cell (unique on depot+week+staff+day). */
export interface UpsertShiftData {
  depotId: string;
  staffId: string;
  staffName: string;
  weekStart: string;
  day: number;
  shift: ShiftKind;
}

export interface RosterRepository {
  /** All cells for one depot's week (any order — the grid keys them client-side). */
  listForWeek(depotId: string, weekStart: string): Promise<ShiftAssignment[]>;
  /** Set (create or overwrite) a single cell. */
  upsertCell(assignment: UpsertShiftData): Promise<ShiftAssignment>;
  /** Set many cells at once (e.g. seeding a fresh week). */
  bulkUpsert(assignments: UpsertShiftData[]): Promise<ShiftAssignment[]>;
}
