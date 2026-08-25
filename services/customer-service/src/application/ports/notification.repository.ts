export interface NotificationPreferenceRecord {
  customerId: string;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
  /** Per-app fine-grained category mutes (design 7b). Empty = all on. */
  categories: Record<string, boolean>;
  /**
   * K5.3: the language this customer's messages are written in. 'id' | 'en', default 'id'.
   *
   * The app's own language lives in the browser; this is the copy the SENDER reads, because
   * WhatsApp and push are rendered server-side by crm-service and it has no browser to ask.
   */
  locale: string;
}

export interface NotificationPreferenceRepository {
  findByCustomerId(customerId: string): Promise<NotificationPreferenceRecord | null>;
  upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord>;
}
