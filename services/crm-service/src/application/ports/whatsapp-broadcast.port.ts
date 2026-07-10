/**
 * Sends a single broadcast message over WhatsApp. This port NEVER throws — one recipient
 * failing must not abort the whole broadcast, so failures come back as { ok: false, error }
 * for the caller to tally. Success is { ok: true }.
 */
export interface WhatsappBroadcastPort {
  send(phone: string, message: string): Promise<{ ok: boolean; error?: string }>;
}
