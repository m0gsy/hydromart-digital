export const DAILY_CLOSE_REPOSITORY = Symbol('DailyCloseRepository');

/** One depot's day, as recorded when somebody closed it. */
export interface DailyCloseRecord {
  id: string;
  depotId: string;
  /** 'YYYY-MM-DD' — a business day, not an instant. */
  businessDate: string;
  closedAt: Date;
  closedBy: string;
  cashInIdr: number;
  cashOutIdr: number;
  konterIdr: number;
  codDepositedIdr: number;
  codExpectedIdr: number;
  note: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
}

export interface CloseDayData {
  depotId: string;
  businessDate: string;
  closedBy: string;
  cashInIdr: number;
  cashOutIdr: number;
  konterIdr: number;
  codDepositedIdr: number;
  codExpectedIdr: number;
  note: string | null;
}

export interface DailyCloseRepository {
  find(depotId: string, businessDate: string): Promise<DailyCloseRecord | null>;
  /**
   * Record the close. Upserts on (depot, day): closing a day that HQ reopened replaces the
   * snapshot and clears the reopen marks, rather than leaving two rows disagreeing about
   * the same day.
   */
  close(data: CloseDayData): Promise<DailyCloseRecord>;
  /** Mark a closed day open again. Only HQ reaches this. */
  reopen(depotId: string, businessDate: string, reopenedBy: string): Promise<DailyCloseRecord>;
}
