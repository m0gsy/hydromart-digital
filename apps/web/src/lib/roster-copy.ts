import type { ShiftAssignment, ShiftKind } from '@/lib/types';

/**
 * The cells that copying one week onto another should write.
 *
 * `PUT /shifts/api/v1/shifts/bulk` ("Set many roster cells of one week at once") was built
 * and left unwired, recorded as "the roster grid writes one cell at a time — there is no
 * multi-cell save in the UI for a bulk route to serve". That was true, and it is the
 * description of a gap rather than a decision: filling a week one tap at a time is 7 × N
 * separate requests, each able to fail on its own, leaving a half-written roster with
 * nothing to roll back to.
 *
 * Copying last week is the operation that needs the bulk route, and the one a depot
 * actually does — most couriers work the same pattern week after week.
 *
 * Pure so it can be tested without the page: the grid needs half a dozen contexts to
 * render, and the rule below is the part that can be wrong.
 */
export function copyWeekCells(
  source: ShiftAssignment[],
  /** Rows currently on the grid — a courier who has since left must not be re-rostered. */
  staffOnGrid: { id: string; name: string }[],
): { staffId: string; staffName: string; day: number; shift: ShiftKind }[] {
  const onGrid = new Map(staffOnGrid.map((s) => [s.id, s.name]));
  return (
    source
      /*
       * OFF is not copied. The bulk write sets what it is given, so sending every OFF cell
       * would be a much larger payload saying nothing — and, more to the point, it would
       * overwrite a shift somebody has already entered for the new week with an OFF that
       * only means "nobody had filled this in last week".
       */
      .filter((a) => a.shift !== 'OFF')
      .filter((a) => onGrid.has(a.staffId))
      .map((a) => ({
        staffId: a.staffId,
        // The name from the CURRENT grid, not last week's snapshot: the row is a
        // denormalised label, and a courier who changed their name should not have the old
        // one written back.
        staffName: onGrid.get(a.staffId) as string,
        day: a.day,
        shift: a.shift,
      }))
  );
}

/** The ISO date of the Monday `weeks` before `weekStart` (yyyy-mm-dd in, yyyy-mm-dd out). */
export function shiftWeekStart(weekStart: string, weeks: number): string {
  // Parsed as UTC on purpose. A roster week is a calendar label, not an instant, and
  // building it from local time makes the answer depend on the operator's own clock —
  // which in WIB is the one that rolls over first.
  const d = new Date(`${weekStart}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
