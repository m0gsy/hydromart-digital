/** One event row in the per-admin notification matrix. */
export interface NotificationChannelPref {
  id: string;
  push: boolean;
  email: boolean;
  wa: boolean;
}

export interface AdminNotificationPrefRecord {
  accountId: string;
  channels: NotificationChannelPref[];
  updatedAt: Date;
}

export interface AdminNotificationPrefRepository {
  /** Prefs for one account, or null when the account has never saved any. */
  get(accountId: string): Promise<AdminNotificationPrefRecord | null>;
  /** Create-or-replace an account's prefs (PUT semantics). */
  save(accountId: string, channels: NotificationChannelPref[]): Promise<AdminNotificationPrefRecord>;
}
