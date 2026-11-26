// HD-15B PR-4: supervisor visits. Mirrors the Prisma models; pure rules, no I/O. Every day here is a
// WIB day key (YYYY-MM-DD) taken through @hydromart/platform, never a UTC cut.
import { addLocalDays, localDayKey } from '@hydromart/platform';

export enum VisitStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export enum VisitItemResult {
  PENDING = 'PENDING',
  PASS = 'PASS',
  FINDING = 'FINDING',
}

export enum FollowUpStatus {
  OPEN = 'OPEN',
  DONE = 'DONE',
}

export interface VisitItem {
  id: string;
  visitId: string;
  depotId: string;
  position: number;
  text: string;
  sopId: string | null;
  sopVersionId: string | null;
  sopVersionNo: number | null;
  sopTitle: string | null;
  result: VisitItemResult;
  findingNote: string | null;
  photoKey: string | null;
  /** WIB day key, or null when the line is not a finding. */
  followUpDueOn: string | null;
  followUpStatus: FollowUpStatus | null;
  followUpDoneAt: Date | null;
  followUpDoneBy: string | null;
  followUpNote: string | null;
  lastOverdueNoticeAt: Date | null;
}

export interface Visit {
  id: string;
  depotId: string;
  templateId: string | null;
  templateName: string;
  visitorId: string;
  status: VisitStatus;
  checkInAt: Date;
  checkInLat: number;
  checkInLng: number;
  checkInAccuracyM: number | null;
  checkInDistanceM: number | null;
  approximateFix: boolean;
  fenceChecked: boolean;
  completedAt: Date | null;
  items: VisitItem[];
}

/** The longest a follow-up deadline may be set out, in days from today. */
export const MAX_FOLLOW_UP_DAYS = 90;

/** A finding's photo key: this visit's own folder, a uuid file, an image extension. */
export function photoKeyPattern(visitId: string): RegExp {
  return new RegExp(`^visits/${visitId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
}

/** Whether a follow-up deadline (WIB day key) lies in [today, today + 90 days]. */
export function dueDayInWindow(dueKey: string, now: Date): boolean {
  return dueKey >= localDayKey(now) && dueKey <= localDayKey(addLocalDays(now, MAX_FOLLOW_UP_DAYS));
}

/** An open follow-up is overdue only AFTER its deadline day: due today is still on time. */
export function followUpOverdue(dueKey: string, now: Date): boolean {
  return dueKey < localDayKey(now);
}

/** A visit may be completed once no line is still waiting for an answer. */
export function allAnswered(items: readonly Pick<VisitItem, 'result'>[]): boolean {
  return items.every((i) => i.result !== VisitItemResult.PENDING);
}

/**
 * `followUpDueOn` is a Prisma `@db.Date`: a Date at UTC midnight of the calendar day the supervisor
 * picked. The UTC slice of THAT value is the WIB day; it is not a clock reading.
 */
export function dayKeyOfDate(date: Date): string {
  // tz-ok: @db.Date, the UTC slice IS the local day
  return date.toISOString().slice(0, 10);
}

/** The @db.Date value for a WIB day key. */
export function dateOfDayKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}
