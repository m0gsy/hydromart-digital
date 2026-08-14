/**
 * On-time delivery for one depot over one window, read from delivery-service.
 *
 * order-service holds no delivery timings — an order's status says it was delivered, never
 * whether it was late — so the monthly review's `slaPct` cannot be derived here, and the
 * honest options were "ask the service that measures it" or "keep printing null". This is
 * the first one.
 *
 * Null when delivery-service is unreachable or unconfigured. Not 0: an on-time rate of zero
 * is a depot in crisis, and an outage must not read as one.
 */
export interface DeliverySlaPort {
  /** Share of deliveries inside the SLA threshold, 0..1, or null when nothing was delivered. */
  onTimeRate(depotId: string, from: Date, to: Date): Promise<number | null>;
}
