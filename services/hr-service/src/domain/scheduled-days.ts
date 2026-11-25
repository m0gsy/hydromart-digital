import { parseWeeklyOffDays } from './calendar';
import { RotationPattern, ShiftAssignmentLike, assignmentInForce } from './shift-rotation';

/**
 * HD-6 H-02, choice 35A: which days an employee is SCHEDULED to work, for the attendance rate and
 * "tidak hadir". It is the rule payroll's `workingDays` / `employmentWindow` / `rotaFor` already
 * apply, with two differences: the assignment is read per day (payroll takes the one in force at the period
 * start for the whole month) and employees with no shift of their own are counted apart. Rules:
 *   - employed: `joinDate`..`exitDate` (an open end when there is none), as payroll's window;
 *   - not a holiday of the depot the employee is assigned to (Employee.depotId, not the home depot; national or that depot's), as payroll;
 *   - the shift assignment in force on that day decides the week: a rotation's blank weekday is
 *     a rest day, any other shift rests on the depot's weekly-off days (payroll's fallback).
 * An employee with no shift of their own (no assignment, no `Employee.shiftId`) has no schedule.
 * Payroll would still treat the depot's weekly-off days as theirs; here those days are counted
 * apart (`unscheduled`), never silently assumed to be scheduled.
 */
export interface ScheduleInput {
  /** `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
  joinDay: string | null;
  exitDay: string | null;
  /** The employee's assignments, oldest first (ties: the later listed wins, as everywhere). */
  assignments: readonly ShiftAssignmentLike[];
  /** Rotation id -> its weekly pattern. */
  patterns: ReadonlyMap<string, RotationPattern>;
  /** `Employee.shiftId` (the legacy single shift payroll falls back to). */
  ownShift: boolean;
  /** The depot's weekly-off CSV (`parseWeeklyOffDays`). */
  weeklyOffCsv: string;
  /** Holidays that apply to the employee's depot, `YYYY-MM-DD`. */
  holidays: ReadonlySet<string>;
}

export interface ScheduleResult {
  /** Employed workdays on which the employee is scheduled. */
  scheduled: string[];
  /** Employed workdays by the depot's rule on which the employee has no schedule of their own. */
  unscheduled: string[];
}

export function scheduleOf(input: ScheduleInput): ScheduleResult {
  const off = parseWeeklyOffDays(input.weeklyOffCsv);
  const scheduled: string[] = [];
  const unscheduled: string[] = [];
  const end = new Date(`${input.to}T00:00:00.000Z`);
  for (
    const cursor = new Date(`${input.from}T00:00:00.000Z`);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    // tz-ok: `cursor` is a calendar day walked with UTC-day arithmetic, never an instant.
    const day = cursor.toISOString().slice(0, 10);
    if (input.joinDay && day < input.joinDay) continue;
    if (input.exitDay && day > input.exitDay) continue;
    if (input.holidays.has(day)) continue;
    const weekday = cursor.getUTCDay();
    const inForce = assignmentInForce(input.assignments, cursor);
    const pattern = inForce?.rotationId ? input.patterns.get(inForce.rotationId) : undefined;
    if (pattern) {
      // A rotation is a whole week: a blank weekday is that employee's rest day.
      if (pattern[weekday]) scheduled.push(day);
    } else if (inForce?.shiftId || input.ownShift) {
      if (!off.has(weekday)) scheduled.push(day);
    } else if (!off.has(weekday)) {
      unscheduled.push(day);
    }
  }
  return { scheduled, unscheduled };
}
