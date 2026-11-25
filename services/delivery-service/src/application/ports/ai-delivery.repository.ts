/** A depot and the instants `[from, to)` during which the AI read API's caller may read it. */
export interface AiSpan {
  depotId: string;
  from: Date;
  to: Date;
}

export interface AiDeliveredStats {
  /** Deliveries delivered in the spans, by delivery time (K-01). */
  delivered: number;
  /** Of them, on time: the stored verdict where there is one, else graded with `thresholdMinutes`. */
  onTime: number;
  /** How many of `delivered` carry a stored verdict (the rest were graded by `thresholdMinutes`). */
  storedVerdicts: number;
  /** Median minutes from the clock's start to delivery; null when nothing was delivered (K-03). */
  medianMinutes: number | null;
  /** Distinct couriers with a delivery in the spans. */
  couriers: number;
}

export interface AiFailedStats {
  /** Deliveries that ended FAILED, by failure time (K-04). */
  failed: number;
  /** Of them, failed as a no-show (the one reason with a fixed text). The rest is free text. */
  noShow: number;
  /** Times a delivery was handed back to be rescheduled, by when it happened. Counted apart. */
  rescheduled: number;
}

export interface AiDeliveryRepository {
  deliveredStats(spans: readonly AiSpan[], thresholdMinutes: number): Promise<AiDeliveredStats>;
  failedStats(spans: readonly AiSpan[]): Promise<AiFailedStats>;
}
