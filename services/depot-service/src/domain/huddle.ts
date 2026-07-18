// Weekly depot team huddle notes (design depotTeam). One note per depot per ISO week,
// carrying the meeting's agenda and follow-up action items. Mirrors the Prisma model;
// the domain never imports the generated client.

/** One agenda line discussed in the huddle. */
export interface HuddleAgendaItem {
  title: string;
  note: string;
}

/** One follow-up assigned out of the huddle. */
export interface HuddleActionItem {
  text: string;
  assignee: string;
  done: boolean;
}

/** A depot's weekly huddle record, unique per [depotId, weekStart]. */
export interface HuddleNote {
  id: string;
  depotId: string;
  /** ISO date of the week's Monday, e.g. "2026-07-14". */
  weekStart: string;
  heldAt: Date;
  attendance: string | null;
  agenda: HuddleAgendaItem[];
  actionItems: HuddleActionItem[];
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
