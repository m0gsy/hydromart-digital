import { Inject, Injectable, Logger } from '@nestjs/common';
import { can } from '@hydromart/access';

import { AdminConfigService } from '../../config/admin-config.service';
import { StaffDirectoryPort } from '../ports/staff-directory.port';
import { StaffMailer } from '../ports/staff-mailer.port';
import { ADMIN_TOKENS } from '../tokens';
import { AdminNotificationPrefService } from './admin-notification-pref.service';

/** What crm hands over for one notification: who it is for, its switch, its copy, its screen. */
export interface StaffEmailRequest {
  accountIds: string[];
  /** The notification's switch on /hq/profile: the same id its push is keyed by. */
  toggle: string;
  subject: string;
  text: string;
  /** The screen the notification opens, relative to the web origin. */
  path: string;
}

export interface StaffEmailResult {
  sent: number;
  failed: number;
  /** Not attempted: email switched off, not an active staff login, no address, or no SMTP. */
  skipped: number;
}

/** At most this many messages per toggle per hour: internal calls skip the throttler. */
export const STAFF_EMAIL_HOURLY_CAP = 120;
const HOUR_MS = 60 * 60 * 1000;
/** Recipients written to at the same time: a handful of SMTP connections, not one per person. */
const BATCH = 3;

/** A header is one line: format characters out, control characters and whitespace runs one space. */
const oneLine = (value: string): string =>
  value.replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();

/** An SMTP refusal usually quotes the recipient; the log keeps the reason, not the address. */
const withoutAddresses = (reason: unknown): string =>
  `${(reason as Error).message}`.replace(/\S+@\S+/g, '<address>');

/**
 * The body as sent: crm's text, the full link to the notification's screen, and why this person
 * got it. Plain text only: the applicant-typed values in crm's text are never read as HTML.
 */
export function staffEmailText(text: string, path: string, origin: string): string {
  return [
    text,
    '',
    `${origin}${path}`,
    '',
    'Email ini terkirim karena email untuk notifikasi ini menyala di profil Anda. ' +
      `Ubah di ${origin}/hq/profile.`,
  ].join('\n');
}

/**
 * The email channel of staff notifications. Owner rule 24 Nov 2026: every staff notification an
 * n8n workflow raises goes out on the bell and push, email, and (once Meta is ready) WhatsApp.
 * crm writes the copy and calls this once per notification, when it files it, with the accounts
 * the notification is for: a retry or a replay of the event never gets here. Each account gets a
 * message of its own when its switch has email on (the /hq/profile default per switch), its
 * login is active staff and it has an address. A failed send is logged and counted, never thrown:
 * the bell and the push already went out. SMTP unset sends nothing and says so once per process.
 */
@Injectable()
export class StaffEmailService {
  private readonly logger = new Logger(StaffEmailService.name);
  private smtpUnsetSaid = false;
  // ponytail: per process. admin-service runs as one replica in docker-compose.prod.yml; the cap
  // is then per toggle. If admin ever scales out, the ceiling is replicas x cap: use a shared counter.
  private readonly windows = new Map<string, { start: number; sent: number; warned: boolean }>();

  constructor(
    private readonly config: AdminConfigService,
    private readonly prefs: AdminNotificationPrefService,
    @Inject(ADMIN_TOKENS.StaffDirectory) private readonly directory: StaffDirectoryPort,
    @Inject(ADMIN_TOKENS.StaffMailer) private readonly mailer: StaffMailer,
  ) {}

  async send(req: StaffEmailRequest): Promise<StaffEmailResult> {
    if (!this.config.smtp) {
      if (!this.smtpUnsetSaid) {
        this.smtpUnsetSaid = true;
        this.logger.warn('SMTP not configured (SMTP_HOST or SMTP_FROM blank): staff email is not sent');
      }
      return { sent: 0, failed: 0, skipped: req.accountIds.length };
    }
    const wanted = await this.prefs.emailOnFor(req.accountIds, req.toggle);
    const accounts = wanted.length > 0 ? await this.directory.accountsByIds(wanted) : [];
    // Staff email is for HQ staff: active, and able to open /hq/profile (where the switch lives)
    // and the /hq screen the link points to.
    const staff = accounts.filter((a) => a.status === 'ACTIVE' && can('hqConsole', a.role));
    const withAddress = staff.flatMap((a) => (a.email ? [{ id: a.id, email: a.email }] : []));
    const room = this.room(req.toggle, withAddress.length);
    const to = withAddress.slice(0, room);
    const subject = oneLine(req.subject);
    const text = staffEmailText(req.text, req.path, this.config.webOrigin);
    let failed = 0;
    for (let at = 0; at < to.length; at += BATCH) {
      const batch = to.slice(at, at + BATCH);
      const results = await Promise.allSettled(
        batch.map((r) => this.mailer.send({ to: r.email, subject, text })),
      );
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') return;
        failed += 1;
        this.logger.warn(`staff email to ${batch[i].id} failed: ${withoutAddresses(result.reason)}`);
      });
    }
    this.logger.log(
      `staff email ${req.toggle} ${req.path}: ${req.accountIds.length} accounts, ` +
        `${req.accountIds.length - wanted.length} switched off, ` +
        `${wanted.length - staff.length} not active HQ staff, ` +
        `${staff.length - withAddress.length} without an address, ` +
        `${withAddress.length - to.length} over the hourly cap, ${to.length - failed} sent, ${failed} failed`,
    );
    return { sent: to.length - failed, failed, skipped: req.accountIds.length - to.length };
  }

  /** How many of `want` messages the toggle may still send in its current one-hour window. */
  private room(toggle: string, want: number): number {
    const now = Date.now();
    let w = this.windows.get(toggle);
    if (!w || now - w.start >= HOUR_MS) {
      w = { start: now, sent: 0, warned: false };
      this.windows.set(toggle, w);
    }
    const allowed = Math.max(0, Math.min(want, STAFF_EMAIL_HOURLY_CAP - w.sent));
    w.sent += allowed;
    if (allowed < want && !w.warned) {
      w.warned = true;
      this.logger.warn(`staff email ${toggle}: hourly cap of ${STAFF_EMAIL_HOURLY_CAP} reached, the rest is not sent`);
    }
    return allowed;
  }
}
