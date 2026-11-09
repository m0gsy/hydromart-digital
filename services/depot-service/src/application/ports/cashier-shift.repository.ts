import { CashierShift } from '../../domain/cashier-shift';

export interface OpenShiftData {
  depotId: string;
  cashierId: string;
  cashierName: string;
  openingFloat: number;
}

export interface CloseShiftData {
  closedAt: Date;
  countedCash: number;
  expectedCash: number;
  variance: number;
  note: string | null;
}

export interface CashierShiftRepository {
  open(data: OpenShiftData): Promise<CashierShift>;
  findById(id: string): Promise<CashierShift | null>;
  /** The cashier's own open shift at this depot, if any. */
  findOpen(depotId: string, cashierId: string): Promise<CashierShift | null>;
  /** Every open shift at the depot — the manager's view of who is on the counter. */
  listOpen(depotId: string): Promise<CashierShift[]>;
  /** Closed shifts at the depot, newest first. */
  listClosed(depotId: string, limit: number): Promise<CashierShift[]>;
  /**
   * Closes an OPEN shift. Compare-and-set: throws ShiftAlreadyClosedError when the shift is
   * no longer OPEN, so of two concurrent closes exactly one proceeds to post the cashbook.
   */
  close(id: string, data: CloseShiftData): Promise<CashierShift>;
  /**
   * DEP-05: record a rejected shortfall as the cashier's liability. Writes only while the
   * shift has none, so a repeated rejection callback cannot double it. False = already set.
   */
  recordLiability(id: string, amountIdr: number): Promise<boolean>;
  /** Sum of liabilities on this cashier's CLOSED shifts at the depot, other than `exceptShiftId`. */
  outstandingLiability(depotId: string, cashierId: string, exceptShiftId?: string): Promise<number>;
}
