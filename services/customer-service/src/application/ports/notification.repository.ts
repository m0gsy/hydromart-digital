export interface NotificationPreferenceRecord {
  customerId: string;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
}

export interface NotificationPreferenceRepository {
  findByCustomerId(customerId: string): Promise<NotificationPreferenceRecord | null>;
  upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord>;
}
