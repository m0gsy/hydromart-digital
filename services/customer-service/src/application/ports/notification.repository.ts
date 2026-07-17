export interface NotificationPreferenceRecord {
  customerId: string;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
  /** Per-app fine-grained category mutes (design 7b). Empty = all on. */
  categories: Record<string, boolean>;
}

export interface NotificationPreferenceRepository {
  findByCustomerId(customerId: string): Promise<NotificationPreferenceRecord | null>;
  upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord>;
}
