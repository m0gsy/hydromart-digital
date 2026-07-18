// Courier shift roster vocabulary (design: operator cell 6d "Jadwal shift kurir" +
// manager cell 7b). A week's roster is a grid of cells keyed by (staff, day). Mirrors the
// Prisma enum; the domain never imports the generated client.

export enum ShiftKind {
  MORNING = 'MORNING',
  EVENING = 'EVENING',
  OFF = 'OFF',
}

/**
 * One staff member's shift on one day of a given week.
 * weekStart is the ISO date of that week's Monday (e.g. "2026-07-14"); day is 0=Mon..6=Sun.
 */
export interface ShiftAssignment {
  id: string;
  depotId: string;
  staffId: string;
  staffName: string;
  weekStart: string;
  day: number;
  shift: ShiftKind;
}

/** Cell cycle used by the grid: Pagi → Sore → Libur → Pagi. */
export function nextShift(shift: ShiftKind): ShiftKind {
  if (shift === ShiftKind.MORNING) return ShiftKind.EVENING;
  if (shift === ShiftKind.EVENING) return ShiftKind.OFF;
  return ShiftKind.MORNING;
}
