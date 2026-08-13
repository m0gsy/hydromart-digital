/**
 * The cost side of a depot's month. order-service owns revenue and nothing else.
 *
 * Three numbers rather than one "expenses", because a net profit nobody can decompose is a
 * number nobody can dispute — and because the two sources CAN overlap: a depot that raises
 * a purchase order in the system and also writes the supplier payment in its cash book has
 * described one cost twice. depot-service keeps the goods categories out of `opexIdr` for
 * exactly that reason, and the caller carries the split onto the screen so a stray fourth
 * spelling shows up as a number somebody can question instead of a quiet subtraction.
 *
 * Every field is null when its owning service could not be read. The caller must NOT
 * substitute 0: a profit computed from a payroll nobody could fetch is not a small error,
 * it is the wrong number with a confident face.
 */
export interface DepotCostBreakdown {
  /** Goods received in the window (depot-service purchase orders). */
  cogsIdr: number | null;
  /** Everything else that left the till in the window, goods excluded (depot-service). */
  opexIdr: number | null;
  /** Net payroll for the period (hr-service). */
  payrollIdr: number | null;
}

export interface DepotCostsPort {
  /** Goods + operating cost for one depot over [from, to). Null when depot-service is unreachable. */
  costs(depotId: string, from: Date, to: Date): Promise<{ cogsIdr: number; opexIdr: number } | null>;
  /** Net payroll for one depot and one 'YYYY-MM' period. Null when hr-service is unreachable. */
  payroll(depotId: string, periodMonth: string): Promise<number | null>;
}
