/** A window of instants, `[from, to)`, both ISO 8601. The metric clips these to the stretches it may read. */
export interface InstantRange {
  from: string;
  to: string;
}

/** order-service `reports/internal/depot-sales-summary`: one depot's live sales for a window. */
export interface DepotSalesRow {
  depotId: string;
  orders: number;
  revenueIdr: number;
  shippingIdr: number;
  appOrders: number;
  appRevenueIdr: number;
  counterOrders: number;
  counterRevenueIdr: number;
  cancelledOrders: number;
  deliveredOrders: number;
}

export type MoneyKind = 'collected' | 'pending' | 'refunded';

/** payment-service `payments/internal/depot-money`: money by the depot of the order. */
export interface DepotMoneyRow {
  depotId: string;
  channel: 'counter' | 'delivery';
  method: string;
  /** Pending only: '0-1', '2-3', '4-7' or '8+' (WIB calendar days). */
  age?: string;
  /** Refunded only. */
  orderId?: string;
  amountIdr: number;
  count: number;
}

export interface ProductRow {
  productId: string;
  productName: string;
  orders: number;
  revenueIdr: number;
}

export interface TimeAreaRows {
  /** `heat[weekday][hour]` orders, weekday 0..6 as order-service reckons it. */
  heat: number[][];
  byWeekday: { weekday: number; orders: number; revenueIdr: number }[];
  byArea: { area: string; orders: number; revenueIdr: number }[];
  otherAreas: { orders: number; revenueIdr: number } | null;
}

/**
 * HD-6 H2: the money facts the AI read API reads beside the P&L. Every method answers `null`
 * when its service cannot (down, unwired, refused): the metric then says belum_ada, never 0.
 * Callers pass only the depots and the instants they may read; these reads do no scoping of
 * their own (they run as the internal-key principal).
 */
export interface AiMoneySourcesPort {
  salesSummary(depotIds: readonly string[], range: InstantRange): Promise<DepotSalesRow[] | null>;
  productRevenue(depotIds: readonly string[], range: InstantRange): Promise<ProductRow[] | null>;
  timeArea(depotIds: readonly string[], range: InstantRange): Promise<TimeAreaRows | null>;
  money(kind: MoneyKind, depotIds: readonly string[], range: InstantRange): Promise<DepotMoneyRow[] | null>;
  /** Of these order ids, those order-service still counts as sales. */
  countingOrders(orderIds: readonly string[]): Promise<Set<string> | null>;
  /** One depot: goods received (cogs) and cashbook cost (opex) over a window. */
  cashbookCosts(depotId: string, range: InstantRange): Promise<{ cogsIdr: number; opexIdr: number } | null>;
  /** One depot: days of the window the depot closed its books. */
  daysClosed(depotId: string, range: InstantRange): Promise<number | null>;
  /** One depot: courier COD handed in and accepted, and what was expected, over a window. */
  codDeposited(depotId: string, range: InstantRange): Promise<{ depositedIdr: number; expectedIdr: number } | null>;
  /** One depot, one WIB month (`YYYY-MM`): net cash flow (arus kas), null inside when a cost term is unreadable. */
  cashFlow(depotId: string, month: string): Promise<{ netCashFlowIdr: number | null } | null>;
}
