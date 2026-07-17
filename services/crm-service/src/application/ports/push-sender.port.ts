import { WebPushSubscriptionRecord } from './push.repository';

export interface PushPayload {
  title: string;
  body: string;
  /** Relative URL to open when the notification is clicked. */
  url?: string;
}

/**
 * Sends one Web Push message. NEVER throws — a single dead endpoint must not abort a
 * fan-out. `gone: true` signals a 404/410 (expired subscription) so the caller prunes it.
 */
export interface PushSenderPort {
  send(sub: WebPushSubscriptionRecord, payload: PushPayload): Promise<{ ok: boolean; gone?: boolean }>;
}
