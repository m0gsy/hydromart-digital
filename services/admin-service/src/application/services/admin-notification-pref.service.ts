import { Inject, Injectable } from '@nestjs/common';

import {
  AdminNotificationPrefRecord,
  AdminNotificationPrefRepository,
  NotificationChannelPref,
} from '../ports/admin-notification-pref.repository';
import { ADMIN_TOKENS } from '../tokens';

// Canonical HQ event list + default channels (Design 23a). Labels are i18n on the web — the
// backend only owns the event ids and their defaults. Order is stable (drives the UI matrix).
export const NOTIFICATION_EVENT_IDS = [
  'criticalSla',
  'newFranchiseApp',
  'payoutPending',
  'systemIncident',
  'dailyDigest',
] as const;

const DEFAULTS: NotificationChannelPref[] = [
  { id: 'criticalSla', push: true, email: true, wa: false },
  { id: 'newFranchiseApp', push: true, email: true, wa: false },
  { id: 'payoutPending', push: true, email: true, wa: true },
  { id: 'systemIncident', push: true, email: true, wa: true },
  { id: 'dailyDigest', push: false, email: true, wa: false },
];

@Injectable()
export class AdminNotificationPrefService {
  constructor(
    @Inject(ADMIN_TOKENS.AdminNotificationPrefRepository)
    private readonly repo: AdminNotificationPrefRepository,
  ) {}

  /** Prefs for one account as the canonical event list, defaults filling any unset event. */
  async get(accountId: string): Promise<AdminNotificationPrefRecord> {
    const existing = await this.repo.get(accountId);
    const saved = existing?.channels ?? [];
    return {
      accountId,
      channels: this.merge(saved),
      updatedAt: existing?.updatedAt ?? new Date(0),
    };
  }

  /** Replace an account's prefs. Unknown events are dropped; missing ones default. */
  async save(
    accountId: string,
    channels: NotificationChannelPref[],
  ): Promise<AdminNotificationPrefRecord> {
    return this.repo.save(accountId, this.merge(channels));
  }

  /** Project any saved rows onto the canonical event list (defaults for gaps). */
  private merge(saved: NotificationChannelPref[]): NotificationChannelPref[] {
    return DEFAULTS.map((def) => {
      const row = saved.find((r) => r.id === def.id);
      return row
        ? { id: def.id, push: !!row.push, email: !!row.email, wa: !!row.wa }
        : { ...def };
    });
  }
}
