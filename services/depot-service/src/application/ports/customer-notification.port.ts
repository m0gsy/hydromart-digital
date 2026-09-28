/**
 * Sends one customer-facing message through crm-service.
 *
 * Unlike the fire-and-forget alert ports beside it, this REPORTS whether crm took the message:
 * the reminder sweep only records "we asked" when crm accepted it. A reminder that never
 * left must not start a seven-day silence, or the customer is not asked again for a week
 * because of an outage they never saw.
 *
 * Never throws — `false` covers "not configured" and "crm unreachable" alike.
 */
export interface CustomerNotificationPort {
  send(
    event: 'GALLON_RETURN_REMINDER',
    phone: string,
    customerId: string,
    vars: Record<string, string>,
  ): Promise<boolean>;
}
