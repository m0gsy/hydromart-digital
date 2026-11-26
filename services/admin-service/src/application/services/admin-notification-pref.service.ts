import { Inject, Injectable } from '@nestjs/common';

import {
  AdminNotificationPrefRecord,
  AdminNotificationPrefRepository,
  NotificationChannelPref,
} from '../ports/admin-notification-pref.repository';
import { ADMIN_TOKENS } from '../tokens';

// Canonical event lists + default channels (Design 23a). Labels are i18n on the web — the
// backend only owns the event ids and their defaults. Order is stable (drives the UI matrix).
//
// TWO audiences, one table. The HQ list is what /hq/profile edits; the DEPOT list is what the
// depot consoles edit, and it exists because those toggles had no route to call at all — they
// were React state that reset on reload. The row is keyed by the account, so one account can
// legitimately hold both (a SUPER_ADMIN sees both lists); a save only ever touches the ids of
// the caller's own scope, so answering one screen can never wipe the other's prefs.
export const HQ_EVENT_IDS = [
  'criticalSla',
  'newFranchiseApp',
  'morningSummary',
  'aiAccessRequest',
  // AI-26: the weekly Sales report is ready (for the AI web's calon mitra CRM).
  'salesWeekly',
  'payoutPending',
  'systemIncident',
  'dailyDigest',
] as const;

export const DEPOT_EVENT_IDS = [
  'newOrder',
  'lowStock',
  'courierFail',
  'approval',
  'dailySummary',
  // HD-15: also the depot heads' and supervisors' own switch (/dashboard/account), push and email.
  'maintenanceDue',
  // HD-15B: a supervisor visit with findings, and its overdue follow-ups; push and email.
  'visitFinding',
] as const;

export const NOTIFICATION_EVENT_IDS = [...HQ_EVENT_IDS, ...DEPOT_EVENT_IDS] as const;

/**
 * The switches crm-service asks about before it pushes: every depot toggle, and the one HQ
 * toggle with a push behind it, "Lamaran waralaba baru" (AI-5: n8n raises that notification).
 * The other HQ toggles are kept on /hq/profile but nothing pushes for them yet.
 */
export const PUSH_TOGGLE_IDS = [...DEPOT_EVENT_IDS, 'newFranchiseApp', 'morningSummary', 'aiAccessRequest', 'salesWeekly'] as const;

/**
 * Which list an account gets. There is no HQ-only scope on purpose: every role holding
 * `hqConsole` also holds `opsNotif`, so a head-office account genuinely owns both lists,
 * and a third scope nothing could ever select would be a branch no caller reaches.
 */
export type NotificationScope = 'DEPOT' | 'ALL';

const HQ_DEFAULTS: NotificationChannelPref[] = [
  { id: 'criticalSla', push: true, email: true, wa: false },
  { id: 'newFranchiseApp', push: true, email: true, wa: false },
  // AI-9: the Direksi morning summary; WhatsApp is pending until Meta is ready.
  { id: 'morningSummary', push: true, email: true, wa: false },
  // AI-7c: someone asks for AI web access; WhatsApp is pending until Meta is ready.
  { id: 'aiAccessRequest', push: true, email: true, wa: false },
  // AI-26: the weekly Sales report is ready; WhatsApp is pending until Meta is ready.
  { id: 'salesWeekly', push: true, email: true, wa: false },
  { id: 'payoutPending', push: true, email: true, wa: true },
  { id: 'systemIncident', push: true, email: true, wa: true },
  { id: 'dailyDigest', push: false, email: true, wa: false },
];

// A depot's day: everything defaults to push-only (an operator is on the floor, not in an
// inbox) and nothing to email or WhatsApp. `dailySummary` is on too: it is the depot's sales
// update (three a day) and the morning recap, the SOP reports a depot is expected to see, and
// a switch that defaults off would mean nobody receives them until they find the setting.
const DEPOT_DEFAULTS: NotificationChannelPref[] = [
  { id: 'newOrder', push: true, email: false, wa: false },
  { id: 'lowStock', push: true, email: false, wa: false },
  { id: 'courierFail', push: true, email: false, wa: false },
  { id: 'approval', push: true, email: false, wa: false },
  { id: 'dailySummary', push: true, email: false, wa: false },
  // HD-15: depot maintenance due by days or water volume. The one depot toggle with email on, as
  // it always resolved for a depot account (it came from the HQ list); WhatsApp is pending Meta.
  { id: 'maintenanceDue', push: true, email: true, wa: false },
  { id: 'visitFinding', push: true, email: true, wa: false },
];

function defaultsFor(scope: NotificationScope): NotificationChannelPref[] {
  return scope === 'DEPOT' ? DEPOT_DEFAULTS : [...HQ_DEFAULTS, ...DEPOT_DEFAULTS];
}

@Injectable()
export class AdminNotificationPrefService {
  constructor(
    @Inject(ADMIN_TOKENS.AdminNotificationPrefRepository)
    private readonly repo: AdminNotificationPrefRepository,
  ) {}

  /** Prefs for one account as its scope's event list, defaults filling any unset event. */
  async get(
    accountId: string,
    scope: NotificationScope = 'ALL',
  ): Promise<AdminNotificationPrefRecord> {
    const existing = await this.repo.get(accountId);
    const saved = existing?.channels ?? [];
    return {
      accountId,
      channels: this.merge(saved, scope),
      updatedAt: existing?.updatedAt ?? new Date(0),
    };
  }

  /**
   * Which of these accounts have switched PUSH off for one toggle.
   *
   * crm-service asks this before it pushes an alert to staff, so the switches on the settings
   * screens decide what a phone buzzes for. An account that never saved anything has the
   * default for that toggle (DEPOT_DEFAULTS, HQ_DEFAULTS), so "no row" is not "all on". Only
   * PUSH_TOGGLE_IDS are answerable: the other HQ toggles have no push behind them.
   */
  async pushDisabledFor(accountIds: readonly string[], toggle: string): Promise<string[]> {
    if (!(PUSH_TOGGLE_IDS as readonly string[]).includes(toggle)) return [];
    const on = await this.switchedOn(accountIds, toggle, 'push');
    return accountIds.filter((id) => !on.has(id));
  }

  /**
   * Which of these accounts have EMAIL on for one toggle, as /hq/profile shows it: the saved
   * switch, else the toggle's default ("Lamaran waralaba baru" defaults to on). The staff
   * email asks this before it sends anything.
   */
  async emailOnFor(accountIds: readonly string[], toggle: string): Promise<string[]> {
    const on = await this.switchedOn(accountIds, toggle, 'email');
    return accountIds.filter((id) => on.has(id));
  }

  /** One channel of one toggle per account: the saved row, else the default. Unknown toggle = none. */
  private async switchedOn(
    accountIds: readonly string[],
    toggle: string,
    channel: 'push' | 'email',
  ): Promise<Set<string>> {
    const def = [...DEPOT_DEFAULTS, ...HQ_DEFAULTS].find((d) => d.id === toggle);
    if (!def) return new Set();
    const saved = new Map((await this.repo.getMany(accountIds)).map((r) => [r.accountId, r]));
    return new Set(
      accountIds.filter((id) => {
        const row = saved.get(id)?.channels.find((c) => c.id === toggle);
        return row ? !!row[channel] : def[channel];
      }),
    );
  }

  /**
   * Replace the caller's prefs for the events IN THEIR SCOPE.
   *
   * Rows outside the scope are carried over untouched rather than dropped: the depot
   * screens post three ids, and a blind replace would delete the HQ prefs of anybody who
   * holds both lists — a preference disappearing is indistinguishable from one never set.
   */
  async save(
    accountId: string,
    channels: NotificationChannelPref[],
    scope: NotificationScope = 'ALL',
  ): Promise<AdminNotificationPrefRecord> {
    const ids = new Set(defaultsFor(scope).map((d) => d.id));
    const kept = ((await this.repo.get(accountId))?.channels ?? []).filter((c) => !ids.has(c.id));
    const incoming = channels.filter((c) => ids.has(c.id));
    const saved = await this.repo.save(accountId, [...kept, ...incoming]);
    return { ...saved, channels: this.merge(saved.channels, scope) };
  }

  /** Project any saved rows onto one scope's event list (defaults for gaps). */
  private merge(
    saved: NotificationChannelPref[],
    scope: NotificationScope,
  ): NotificationChannelPref[] {
    return defaultsFor(scope).map((def) => {
      const row = saved.find((r) => r.id === def.id);
      return row ? { id: def.id, push: !!row.push, email: !!row.email, wa: !!row.wa } : { ...def };
    });
  }
}
