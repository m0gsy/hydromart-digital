// HD-5: which legal entity employs a person, as dated change points. The legal entities live in
// depot-service; here they are bare ids, checked there on every write.

/** One dated change point: from `effectiveFrom` (a calendar day) the employee works for the entity. */
export interface EmployeeLegalEntityPoint {
  id: string;
  employeeId: string;
  legalEntityId: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  recordedBy: string | null;
  recordedAt: Date;
}

/** An employee and their change points, newest first. */
export interface EmployeeLegalEntityHistory {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  position: string;
  depotId: string | null;
  status: string;
  points: EmployeeLegalEntityPoint[];
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` -> the UTC midnight Prisma stores a `@db.Date` as, or null when the text is not a
 * real calendar day (2026-02-30 is refused, not rolled over into March).
 */
export function parseCalendarDay(text: string): Date | null {
  const m = CALENDAR_DAY.exec(text);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatCalendarDay(day) === text ? day : null;
}

/** The calendar day a `@db.Date` holds, as `YYYY-MM-DD`. */
export function formatCalendarDay(day: Date): string {
  // tz-ok: a @db.Date is stored as UTC midnight, so the UTC slice IS the calendar day.
  return day.toISOString().slice(0, 10);
}
