/**
 * Fires a customer notification via crm-service (spec 5h feed). Fails OPEN: a failure
 * never blocks the action that triggered it (e.g. a voucher grant).
 */
export interface NotificationPort {
  notify(
    event: string,
    phone: string,
    customerId: string,
    vars: Record<string, string>,
  ): Promise<void>;
}
