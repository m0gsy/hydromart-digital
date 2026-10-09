// Which depot an employee worked at on a given local day. Pure, no I/O.
//
// `Employee.depotId` is the depot an employee is at RIGHT NOW; the ledger of moves
// (`EmployeeDepotMove`) is what says where they were on any other day. Every historic
// question - the geofence a punch is checked against, the share of a payslip a depot pays -
// asks this function instead of reading the live column, so a move today cannot rewrite
// the cost of last month.
//
// Dates are local `YYYY-MM-DD` keys (the `@db.Date` columns), compared as strings and
// stepped with civil-calendar arithmetic. No `Date` object is involved, so no timezone can
// shift a day under it.

export type DepotMoveKind = 'PERMANENT' | 'LOAN_START' | 'LOAN_END';

export interface DepotMove {
  kind: DepotMoveKind;
  /** Local day the move takes effect (first day AT the new depot). */
  effectiveDate: string;
  /** Orders moves that share a day; the ledger's insertion sequence. */
  seq: number;
  fromDepotId: string | null;
  toDepotId: string | null;
  /**
   * LOAN_START only: the last day of the assignment the move belongs to. A sweep that died
   * never wrote the LOAN_END row; without this the employee would stay "on loan" forever.
   */
  loanEndDate?: string | null;
}

export interface DepotOnEmployee {
  /** The depot the employee belongs to; null on rows that predate the column. */
  homeDepotId: string | null;
  /** The live operational depot. Only a fallback: history never reads it once moves exist. */
  depotId: string | null;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 of a civil date (Hinnant's days_from_civil). */
function toOrdinal(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromOrdinal(z0: number): string {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function ordinalOf(key: string): number {
  const match = DATE_KEY.exec(key);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const ordinal = toOrdinal(y, m, d);
    if (fromOrdinal(ordinal) === key) return ordinal; // rejects 2026-02-30, month 13...
  }
  throw new RangeError(`Tanggal lokal tidak valid: "${key}" (harus YYYY-MM-DD)`);
}

/** The local day `n` days after (or before, when negative) `key`. */
export function addDays(key: string, n: number): string {
  return fromOrdinal(ordinalOf(key) + n);
}

/** True for a real calendar day written YYYY-MM-DD (rejects 2026-02-30, month 13...). */
export function isLocalDay(key: string): boolean {
  try {
    ordinalOf(key);
    return true;
  } catch {
    return false;
  }
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return ordinalOf(to) - ordinalOf(from);
}

interface Event {
  date: string;
  /** Virtual returns sort before real moves of the same day. */
  order: 0 | 1;
  seq: number;
  from: string | null;
  to: string | null;
  /** PERMANENT moves reset home; virtual returns go to home, not to the loan's origin. */
  kind: DepotMoveKind | 'RETURN';
  /** Virtual returns apply only while the employee is still where the loan put them. */
  onlyIfAt?: string | null;
}

/** Resolve the ledger once; the returned lookup is cheap enough to call per day. */
export function depotTimeline(
  employee: DepotOnEmployee,
  moves: readonly DepotMove[],
): (localDate: string) => string | null {
  const events: Event[] = [];
  for (const m of moves) {
    events.push({
      date: m.effectiveDate,
      order: 1,
      seq: m.seq,
      from: m.fromDepotId,
      to: m.toDepotId,
      kind: m.kind,
    });
    if (m.kind === 'LOAN_START' && m.loanEndDate) {
      events.push({
        date: fromOrdinal(ordinalOf(m.loanEndDate) + 1),
        order: 0,
        seq: m.seq,
        from: m.toDepotId,
        to: null,
        kind: 'RETURN',
        onlyIfAt: m.toDepotId,
      });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order || a.seq - b.seq));

  const firstReal = events.find((e) => e.order === 1);
  const initial = firstReal ? firstReal.from : (employee.homeDepotId ?? employee.depotId ?? null);

  return (localDate: string) => {
    ordinalOf(localDate);
    let current = initial;
    let home = initial;
    for (const e of events) {
      if (e.date > localDate) break;
      if (e.kind === 'RETURN') {
        if (current === e.onlyIfAt) current = home;
        continue;
      }
      current = e.to;
      if (e.kind === 'PERMANENT') home = e.to;
    }
    return current;
  };
}

/**
 * The depot an employee BELONGS to, whoever they are lent to today. Rows that predate the
 * `homeDepotId` column fall back to the live depot, which for them is the same thing.
 */
export function homeDepotOf(employee: DepotOnEmployee): string | null {
  return employee.homeDepotId ?? employee.depotId;
}

/** The depot the employee worked at on `localDate`. Total: never throws on a valid date. */
export function depotOn(
  employee: DepotOnEmployee,
  moves: readonly DepotMove[],
  localDate: string,
): string | null {
  return depotTimeline(employee, moves)(localDate);
}

export interface DayWeightRange {
  /** Inclusive period, e.g. the payroll month. */
  from: string;
  to: string;
  /** Employment window (joinDate / exitDate), clipped to the period when given. */
  windowFrom?: string | null;
  windowTo?: string | null;
}

/**
 * Calendar days per depot across a period: the weights a payslip is split by.
 * Calendar, not working, days - the weights are never normalised to the month length.
 * A day with no depot (network-wide employee) is dropped; an empty map tells the caller to
 * fall back to the home depot instead of dividing by zero.
 */
export function calendarDayWeights(
  employee: DepotOnEmployee,
  moves: readonly DepotMove[],
  range: DayWeightRange,
): Map<string, number> {
  const start = ordinalOf(range.windowFrom && range.windowFrom > range.from ? range.windowFrom : range.from);
  const end = ordinalOf(range.windowTo && range.windowTo < range.to ? range.windowTo : range.to);
  const weights = new Map<string, number>();
  const at = depotTimeline(employee, moves);
  for (let day = start; day <= end; day += 1) {
    const depot = at(fromOrdinal(day));
    if (depot !== null) weights.set(depot, (weights.get(depot) ?? 0) + 1);
  }
  return weights;
}
