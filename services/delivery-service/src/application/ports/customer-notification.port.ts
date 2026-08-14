/**
 * A customer-facing notification triggered by something that happened to their delivery.
 *
 * Only one event uses it today, and it is the one a customer most needs: RESCHEDULED. A
 * courier who cannot deliver picks a new slot, the order goes back to the dispatch queue,
 * and until now the person waiting at home was told nothing — the code logged
 * "customer notice pending (slice 6 crm)" and returned. The crm plumbing that comment was
 * waiting for has existed for a while; order-service, depot-service, promo-service,
 * hr-service and auth-service all push through it.
 *
 * Fails OPEN, like every other notification adapter here: the reschedule is already
 * committed by the time this is called, so a crm outage must never unwind it.
 */
export interface CustomerNotificationPort {
  notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null,
  ): Promise<void>;
}
