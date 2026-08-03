// One cashier's turn at the counter. Mirrors the Prisma CashierShiftStatus enum; the
// domain never imports the generated client.

export enum CashierShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export interface CashierShift {
  id: string;
  depotId: string;
  cashierId: string;
  cashierName: string;
  status: CashierShiftStatus;
  openingFloat: number;
  openedAt: Date;
  closedAt: Date | null;
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  note: string | null;
}

/**
 * What the drawer should hold: the float it started with plus the cash taken since.
 * Kept as its own function because it is the number a cashier is held to — one place to
 * read, one place to test, no arithmetic buried in a service method.
 */
export function expectedCash(openingFloat: number, cashTakenIdr: number): number {
  return openingFloat + cashTakenIdr;
}

/** Counted minus expected. Negative means the drawer is short. */
export function variance(counted: number, expected: number): number {
  return counted - expected;
}
