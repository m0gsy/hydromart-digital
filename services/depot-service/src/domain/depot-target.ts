// Per-depot monthly performance target (design manager dashboard). A depot sets one
// target row per calendar month; the dashboard compares actuals against it.
export interface DepotTarget {
  id: string;
  depotId: string;
  /** ISO year-month, e.g. "2026-07". */
  month: string;
  revenueTargetIdr: number;
  ordersTarget: number;
  /** On-time SLA target as a whole percent (e.g. 96). */
  slaTargetPct: number;
  newCustomersTarget: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}
