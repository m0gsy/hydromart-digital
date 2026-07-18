import { HuddleActionItem, HuddleAgendaItem, HuddleNote } from '../../domain/huddle';

export interface UpsertHuddleNoteData {
  depotId: string;
  weekStart: string;
  attendance: string | null;
  agenda: HuddleAgendaItem[];
  actionItems: HuddleActionItem[];
  recordedBy: string;
}

export interface HuddleRepository {
  /** Insert or overwrite the note for [depotId, weekStart]. */
  upsert(data: UpsertHuddleNoteData): Promise<HuddleNote>;
  /** The single note for one week, or null. */
  findForWeek(depotId: string, weekStart: string): Promise<HuddleNote | null>;
  /** A depot's notes, newest week first. */
  listForDepot(depotId: string): Promise<HuddleNote[]>;
}
