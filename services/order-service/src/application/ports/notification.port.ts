/**
 * Sends an event-triggered WhatsApp notification to the customer on an order lifecycle
 * change (FR-093/FR-094). Notifications are a side-effect of an already-committed status
 * change, so implementations fail OPEN: a failure never blocks or unwinds the transition.
 * The acting staff member's token is forwarded so crm-service enforces its own RBAC.
 */
export interface NotificationPort {
  notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    customerId: string,
    authorization: string,
  ): Promise<void>;
}
