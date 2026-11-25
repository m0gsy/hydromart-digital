/**
 * HD-6 H3: the customer, delivery and gallon facts the AI read API reads, from order-service,
 * delivery-service and depot-service. Every method answers null when its source cannot answer
 * (down, non-2xx, a shape or number it does not recognise, a row for a depot nobody asked): the
 * metric then says belum_ada, never a partial sum.
 *
 * Reads that count PEOPLE take spans (a depot and the instants it was readable) and are one call:
 * a distinct count cannot be added up across calls.
 */
export interface SourceSpan {
  depotId: string;
  /** ISO 8601 instants, `[from, to)`. */
  from: string;
  to: string;
}

export interface CustomerWindow {
  active: number;
  newCustomers: number;
  repeat: number;
  newAtDepot: { depotId: string; customers: number }[];
}

export interface CohortCell {
  /** `YYYY-MM`, the WIB month of the lifetime first order. */
  cohort: string;
  monthIndex: number;
  customers: number;
}

export interface RatingTotals {
  reviews: number;
  ratingSum: number;
  reviewers: number;
}

export interface SegmentTotals {
  active: number;
  atRisk: number;
  inactive: number;
}

export interface RefillTotals {
  refill: number;
  partial: number;
  beli: number;
  notAsked: number;
}

/** The courier's fixed failure reasons (delivery-service failure-reason.ts), in the order they are shown. */
export const FAILURE_REASON_CODES = ['ADDRESS_NOT_FOUND', 'CUSTOMER_REFUSED', 'GOODS_DAMAGED', 'CANNOT_CONTACT', 'OTHER', 'NO_SHOW', 'DEPOT_CANCELLED'] as const;
export type FailureReasonCode = (typeof FAILURE_REASON_CODES)[number];

export interface DeliverySummary {
  delivered: number;
  onTime: number;
  storedVerdicts: number;
  /** The one threshold old rows were graded with; null when the depots in scope grade with different ones. */
  thresholdMinutes: number | null;
  medianMinutes: number | null;
  /** Distinct couriers with a delivery or a failure in the spans. */
  couriers: number;
  failed: number;
  noShow: number;
  otherFailed: number;
  /** Failed by fixed reason code; null when the source is older than the breakdown or sent a shape we do not know. */
  byReason: Record<FailureReasonCode, number> | null;
  rescheduled: number;
}

export interface GallonLedgerRow {
  depotId: string;
  issuedTotal: number;
  returnedTotal: number;
  depositHeldTotal: number;
  depositRefundedTotal: number;
  issuedInWindow: number;
  depositHeldInWindow: number;
  returnedGoodInWindow: number;
  returnedDamagedInWindow: number;
  depositRefundedInWindow: number;
}

export interface AiCustomerSourcesPort {
  customerWindow(spans: readonly SourceSpan[], periodFrom: string): Promise<CustomerWindow | null>;
  cohorts(spans: readonly SourceSpan[]): Promise<CohortCell[] | null>;
  ratings(spans: readonly SourceSpan[]): Promise<RatingTotals | null>;
  segments(depotIds: readonly string[], at: { riskSince: string; activeSince: string; until: string }): Promise<SegmentTotals | null>;
  /** `byDepot` is null when order-service predates the per-depot answer: a split then has nothing to stand on. */
  gallonsSold(spans: readonly SourceSpan[]): Promise<{ gallons: number; byDepot: { depotId: string; gallons: number }[] | null } | null>;
  refillSplit(spans: readonly SourceSpan[]): Promise<RefillTotals | null>;
  liveOrders(depotIds: readonly string[]): Promise<{ status: string; count: number }[] | null>;
  deliverySummary(spans: readonly SourceSpan[]): Promise<DeliverySummary | null>;
  /** Delivery orders cancelled in the spans that never left the depot (K-04, dictionary choice 21). */
  cancelledBeforeDeparture(spans: readonly SourceSpan[]): Promise<number | null>;
  /** Rows for the depots asked; a depot with no ledger row is absent (it has nothing to say). */
  gallonLedger(depotIds: readonly string[], range: { from: string; to: string }): Promise<GallonLedgerRow[] | null>;
}
