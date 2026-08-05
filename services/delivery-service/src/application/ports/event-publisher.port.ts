/**
 * Reports a domain event to admin-service, which fans it out to whatever partner
 * endpoints subscribed to it (H-30).
 *
 * Fail-open by contract: the handover is already recorded and the customer already has
 * their water. A partner integration being down, or not configured at all, must never
 * turn a completed delivery into an error for the courier standing at the door.
 */
export interface EventPublisherPort {
  publish(event: string, payload: Record<string, unknown>, occurredAt: Date): Promise<void>;
}
