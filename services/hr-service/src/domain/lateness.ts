/**
 * D7 — how late a check-in is, given the shift it belongs to.
 *
 * Extracted from `attendance.service.ts` because the interesting part is arithmetic with
 * one nasty edge, and arithmetic with one nasty edge deserves a test that does not need a
 * Nest module, a repository and a face frame to run.
 *
 * The edge: lateness was measured as `minutesOfDay > startMinutes + tolerance`, both taken
 * on the SAME `workDate`. A shift starting 22:00 (1320) punched at 00:10 (10) gives
 * `10 > 1335` = false — so a courier two hours and ten minutes late was recorded PRESENT
 * with `lateMinutes: 0`, and no fine ever reached the payslip. Night shifts could not be
 * late at all.
 */

export interface LatenessInput {
  /** Minutes since local midnight of the punch. */
  minutesOfDay: number;
  /** Minutes since local midnight of the shift start. */
  startMinutes: number;
  /** Grace period. Note it does NOT move the measuring point — see below. */
  toleranceMinutes: number;
}

export interface Lateness {
  late: boolean;
  /**
   * Measured from the shift start, tolerance INCLUDED. A 15-minute tolerance on an 07:50
   * shift means 07:59 is not late at all, and 08:10 is 20 minutes late — not 5. Long-
   * standing behaviour, pinned by a test so nobody "fixes" it into something else.
   */
  lateMinutes: number;
}

const DAY = 24 * 60;
const HALF_DAY = 12 * 60;

export function latenessFor({
  minutesOfDay,
  startMinutes,
  toleranceMinutes,
}: LatenessInput): Lateness {
  let delta = minutesOfDay - startMinutes;
  // The punch looks impossibly early because the shift began the previous evening and the
  // clock has since crossed midnight. Wrapping it forward gives the real gap.
  //
  // One direction only, deliberately. A symmetric wrap would also rewrite someone who is
  // genuinely thirteen hours late (08:00 shift, punched 21:00) into "three hours early" and
  // erase the lateness entirely — turning a bug that under-reports into one that hides
  // worse. Nobody is thirteen hours early for a shift; people are thirteen hours late.
  if (delta < -HALF_DAY) delta += DAY;

  const late = delta > toleranceMinutes;
  return { late, lateMinutes: late ? delta : 0 };
}
