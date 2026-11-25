/** One depot and the instants `[from, to)` an order may be counted in. */
export interface AiSpan {
  depotId: string;
  from: Date;
  to: Date;
}

export interface DiscountTotals {
  /** Orders that count as sales (neither CANCELLED nor VOIDED) inside the spans. */
  orders: number;
  /** Of those, the ones that carry a discount. */
  discountedOrders: number;
  /** Sum of the order-level discount of those orders, every kind together. */
  discountIdr: number;
}

export interface NewSubscriptions {
  /** Plans made inside the window, whatever their status is now. */
  subscriptions: number;
  /** Distinct customers behind them. */
  subscribers: number;
}

/** HD-6 H4 part 2: the order-side facts of O-07 and O-08. */
export interface AiEngagementRepository {
  discounts(spans: readonly AiSpan[]): Promise<DiscountTotals>;
  /** `[from, to)` by the instant the plan was made. */
  newSubscriptions(from: Date, to: Date): Promise<NewSubscriptions>;
}

export const AI_ENGAGEMENT_REPOSITORY = Symbol('AiEngagementRepository');
