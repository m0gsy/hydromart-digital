export const MONTHLY_CLOSE_REPOSITORY = Symbol('MonthlyCloseRepository');

/** One depot's month, as recorded when somebody sealed it. */
export interface MonthlyCloseRecord {
  id: string;
  depotId: string;
  /** 'YYYY-MM' — a business month, not an instant. */
  businessMonth: string;
  closedAt: Date;
  closedBy: string;
  cashInIdr: number;
  cashOutIdr: number;
  konterIdr: number;
  codDepositedIdr: number;
  codExpectedIdr: number;
  /** How many business days of the month were individually closed when this was sealed. */
  daysClosed: number;
  note: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
}

export interface CloseMonthData {
  depotId: string;
  businessMonth: string;
  closedBy: string;
  cashInIdr: number;
  cashOutIdr: number;
  konterIdr: number;
  codDepositedIdr: number;
  codExpectedIdr: number;
  daysClosed: number;
  note: string | null;
}

export interface MonthlyCloseRepository {
  find(depotId: string, businessMonth: string): Promise<MonthlyCloseRecord | null>;
  /**
   * Record the seal. Upserts on (depot, month): sealing a month HQ reopened replaces the
   * snapshot and clears the reopen marks, rather than leaving two rows disagreeing about
   * the same month.
   */
  close(data: CloseMonthData): Promise<MonthlyCloseRecord>;
  /** Mark a sealed month open again. Only HQ reaches this. */
  reopen(depotId: string, businessMonth: string, reopenedBy: string): Promise<MonthlyCloseRecord>;
  /**
   * The currently-sealed month a business day falls inside, or null. Daily close asks this
   * before touching any day: a day inside a sealed month cannot move without unsealing the
   * month first, or the month's own snapshot would go stale the moment it was signed off.
   */
  findSealing(depotId: string, businessDate: string): Promise<MonthlyCloseRecord | null>;
}
