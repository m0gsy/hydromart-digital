/**
 * HD-12: the one way a WhatsApp message leaves for number 1. The adapter is Meta's Cloud API; nothing else
 * in the service knows its URL or its token.
 */
export type WaSendResult =
  | { ok: true; messageId: string }
  /** `permanent`: Meta will never take this message (a retry cannot help); otherwise it was load or the network. */
  | { ok: false; permanent: boolean; code: string | null; error: string };

export interface WhatsappSenderPort {
  sendTemplate(input: { to: string; name: string; language: string; params: string[] }): Promise<WaSendResult>;
  /** Free text, only valid inside the customer's 24 h service window (a reply to what they just wrote). */
  sendText(input: { to: string; body: string }): Promise<WaSendResult>;
}
