/**
 * HD-6 H3: the customer and gallon facts the AI read API asks for. Every read takes SPANS: a
 * depot and the window of instants `[from, to)` during which the caller may read it. A fact counts
 * only where its depot and its time fall inside one span, so a depot that changed legal entity in
 * the middle of the period is read for the days it was readable and no others.
 */
export interface AiSpan {
  depotId: string;
  from: Date;
  to: Date;
}

/** Customers with orders that count (not CANCELLED, not VOIDED, a named customer) in the spans. */
export interface CustomerWindowStats {
  /** Distinct customers with at least one such order in the spans (C-04). */
  active: number;
  /** Of them, those whose first order anywhere in the network is one of these orders (C-01). */
  newCustomers: number;
  /** Of them, those with any such order anywhere before `periodFrom` (C-05). */
  repeat: number;
  /** Per depot: customers whose first order AT THAT DEPOT is in its span (C-02). Not summable. */
  newAtDepot: { depotId: string; customers: number }[];
}

export interface CohortCell {
  /** The WIB month of the customers' first order, `YYYY-MM`. */
  cohort: string;
  monthIndex: number;
  customers: number;
}

export interface RatingStats {
  reviews: number;
  ratingSum: number;
  /** Distinct named customers who wrote them. */
  reviewers: number;
}

export interface SegmentThresholds {
  /** Last order at or after this instant = active. */
  activeSince: Date;
  /** Last order in [riskSince, activeSince) = at risk; before it = inactive. */
  riskSince: Date;
  /** Orders from this instant on are not counted (the end of the as-of day). */
  until: Date;
}

export interface CustomerSegmentStats {
  active: number;
  atRisk: number;
  inactive: number;
}

export interface RefillSplitStats {
  refill: number;
  partial: number;
  beli: number;
  notAsked: number;
}

/**
 * HD-20c: one distinct customer's counted orders at one distinct pin (lat and lng null = no pin). `k` is a
 * small number WITHIN one answer, never an id: the same customer has the same k on every entry.
 */
export interface AreaPoint {
  k: number;
  lat: number | null;
  lng: number | null;
  orders: number;
  galon: number;
}

export interface AreaPoints {
  points: AreaPoint[];
}

export interface AiCustomerRepository {
  /** HD-20c: at most `limit` pins; null when there are more (the caller refuses, never cuts). */
  areaPoints(spans: readonly AiSpan[], limit: number): Promise<AreaPoints | null>;
  customerWindow(spans: readonly AiSpan[], periodFrom: Date): Promise<CustomerWindowStats>;
  customerCohorts(spans: readonly AiSpan[], timeZone: string): Promise<CohortCell[]>;
  ratingStats(spans: readonly AiSpan[]): Promise<RatingStats>;
  customerSegments(depotIds: readonly string[], at: SegmentThresholds): Promise<CustomerSegmentStats>;
  /** G-01: gallon units on DELIVERED or COMPLETED orders created in the spans, per depot that sold any. */
  gallonsSold(spans: readonly AiSpan[]): Promise<{ depotId: string; gallons: number }[]>;
  /** G-05: counter sales with a gallon line, by the empties the buyer brought. */
  refillSplit(spans: readonly AiSpan[]): Promise<RefillSplitStats>;
  /** K-04: delivery orders cancelled in the spans (by cancel time) that never left the depot (no PICKED_UP or ON_DELIVERY step). */
  cancelledBeforeDeparture(spans: readonly AiSpan[]): Promise<number>;
  /** K-07: delivery orders (counter sales are not in flight) still moving, per status, at these depots, whatever day they were placed. */
  liveByStatus(depotIds: readonly string[]): Promise<{ status: string; count: number }[]>;
}
