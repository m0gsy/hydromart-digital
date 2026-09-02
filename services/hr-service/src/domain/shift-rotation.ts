/**
 * Which shift an employee is on for a given day, and what time that day starts.
 *
 * This decides whether somebody is marked LATE, so it runs for every punch of every day.
 * The precedence is deliberately conservative: an employee with no assignment of their own
 * lands exactly where they landed before this module existed — on the depot's shift, then on
 * the configured work start time. Nobody's daily attendance changes until HR assigns them.
 */

/** A weekly pattern keyed by weekday, 0 = Sunday (matches Date.getUTCDay). */
export type RotationPattern = Record<number, string | null>;

export interface ShiftAssignmentLike {
  shiftId: string | null;
  rotationId: string | null;
  effectiveFrom: Date;
}

/**
 * Accepts whatever came out of the Json column. Anything that is not a 0–6 key mapped to a
 * non-empty string is dropped: a malformed pattern must mean "no shift that day", never a
 * crash in the middle of somebody clocking in.
 */
export function parseRotationPattern(raw: unknown): RotationPattern {
  const out: RotationPattern = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    out[day] = typeof value === 'string' && value.trim() !== '' ? value : null;
  }
  return out;
}

/**
 * The assignment in force on a date: the latest one that had already started. Ties on the
 * same effectiveFrom go to the one listed last, so a correction entered afterwards wins.
 */
export function assignmentInForce<T extends ShiftAssignmentLike>(
  assignments: readonly T[],
  onDate: Date,
): T | null {
  let winner: T | null = null;
  for (const candidate of assignments) {
    if (candidate.effectiveFrom.getTime() > onDate.getTime()) continue;
    if (!winner || candidate.effectiveFrom.getTime() >= winner.effectiveFrom.getTime()) {
      winner = candidate;
    }
  }
  return winner;
}

/** The shift an assignment puts someone on for one day, or null for a day off. */
export function shiftIdForDay(
  assignment: ShiftAssignmentLike | null,
  pattern: RotationPattern | null,
  onDate: Date,
): string | null {
  if (!assignment) return null;
  if (assignment.shiftId) return assignment.shiftId;
  if (!assignment.rotationId || !pattern) return null;
  return pattern[onDate.getUTCDay()] ?? null;
}

/**
 * The clock span of a shift, in minutes. A shift is PRESENCE, not paid work: "08:00–17:00"
 * is nine hours at the depot with the break inside it, which is why payroll subtracts the
 * break from this before calling it a working day.
 *
 * An end that reads earlier than its start is a night shift crossing midnight, not a
 * negative day. Unparseable times yield 0, which payroll reads as "no shift here" and falls
 * back to the depot's configured standard — a malformed row must not invent wages.
 */
export function shiftSpanMinutes(startTime: string, endTime: string): number {
  const minutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const span = minutes(endTime) - minutes(startTime);
  if (!Number.isFinite(span)) return 0;
  return span > 0 ? span : span + 1440;
}

/** Where a start time came from — logged and shown so a late mark stays explainable. */
export type ShiftStartSource = 'employee-assignment' | 'employee-shift' | 'depot-shift' | 'config';

export interface ResolvedShiftStart {
  startTime: string;
  source: ShiftStartSource;
}

/**
 * First non-null wins, most specific first. `configStartTime` is the floor and is always a
 * value, so this never returns nothing.
 */
export function resolveShiftStart(candidates: {
  assignedShiftStart: string | null;
  employeeShiftStart: string | null;
  depotShiftStart: string | null;
  configStartTime: string;
}): ResolvedShiftStart {
  if (candidates.assignedShiftStart) {
    return { startTime: candidates.assignedShiftStart, source: 'employee-assignment' };
  }
  if (candidates.employeeShiftStart) {
    return { startTime: candidates.employeeShiftStart, source: 'employee-shift' };
  }
  if (candidates.depotShiftStart) {
    return { startTime: candidates.depotShiftStart, source: 'depot-shift' };
  }
  return { startTime: candidates.configStartTime, source: 'config' };
}
