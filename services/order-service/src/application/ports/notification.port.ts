/**
 * Sends an event-triggered WhatsApp notification to the customer on an order lifecycle
 * change (FR-093/FR-094). Notifications are a side-effect of an already-committed status
 * change, so implementations fail OPEN: a failure never blocks or unwinds the transition.
 * The acting staff member's token is forwarded so crm-service enforces its own RBAC.
 *
 * D9: fail-open is not the same as fail-invisible. The return value says whether the
 * message actually went — `false` for a refusal, an outage, an unusable phone number, or a
 * deployment with the integration switched off. Callers that cannot act on it ignore it;
 * the scheduled-delivery path cannot, because there is no human in that loop to notice the
 * silence, and it records the fact on the order instead.
 */
export interface NotificationPort {
  notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    /**
     * Null for staff-facing operational events (meter variance), which go to the ops
     * number and belong to no customer. crm-service already stores this nullable.
     */
    customerId: string | null,
    authorization: string,
    /**
     * O6: the depot an OPERATIONAL event is about. crm routes those to that depot's staff
     * and scopes its ops feed by it; ignored for customer events, which are addressed to a
     * person rather than to a place. Optional so every existing caller stays as it was.
     */
    depotId?: string | null,
  ): Promise<boolean>;
}
