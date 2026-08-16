/**
 * Sends a single broadcast message over WhatsApp. This port NEVER throws — one recipient
 * failing must not abort the whole broadcast, so failures come back as { ok: false, error }
 * for the caller to tally. Success is { ok: true }.
 */
export interface WhatsappBroadcastPort {
  send(phone: string, message: string): Promise<{ ok: boolean; error?: string }>;
  /**
   * Whether a real WhatsApp endpoint is configured at all.
   *
   * The sweep asks BEFORE claiming recipients: without it, an unconfigured deployment walks
   * the whole audience and marks every one FAILED, spending the queue on a missing
   * environment variable. Recipients left PENDING are sent the moment it is set.
   */
  configured(): boolean;
}
