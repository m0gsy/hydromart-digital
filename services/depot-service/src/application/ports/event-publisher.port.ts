/**
 * HD-7: hands one event to admin-service, which fans it out to the endpoints subscribed to it.
 * Throws when admin-service does not take it, so the event stays in the outbox and is sent again.
 */
export interface EventPublisherPort {
  publish(
    event: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
    eventId: string,
  ): Promise<void>;
}
