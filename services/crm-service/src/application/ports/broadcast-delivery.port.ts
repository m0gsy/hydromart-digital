/**
 * How a campaign reaches one recipient.
 *
 * This replaced `WhatsappBroadcastPort`. The transport it named was removed with the WABA
 * decision, and the thing that took its place — an in-app inbox row plus best-effort push —
 * lives inside this same service, so it needed no HTTP adapter at all. It still gets a port
 * rather than a direct call to `NotificationService`: `CampaignService` should not know
 * whether delivery is a local write or a network hop, and a one-method fake keeps the sweep
 * tests about the sweep.
 *
 * `deliver` throws on failure. The sweep catches it, records the recipient FAILED with the
 * message, and moves on — one bad recipient must not abandon the batch.
 */
export interface BroadcastDeliveryPort {
  deliver(phone: string, message: string, customerId: string): Promise<void>;
}
