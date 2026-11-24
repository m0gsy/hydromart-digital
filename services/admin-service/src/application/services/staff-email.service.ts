import { Inject, Injectable, Logger } from '@nestjs/common';

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
    // Staff email is for staff: a login that is active and is not a customer's.
    const staff = accounts.filter((a) => a.status === 'ACTIVE' && a.role !== 'CUSTOMER');
    const to = staff.flatMap((a) => (a.email ? [{ id: a.id, email: a.email }] : []));
    const subject = oneLine(req.subject);
    const text = staffEmailText(req.text, req.path, this.config.webOrigin);
    const results = await Promise.allSettled(
      to.map((r) => this.mailer.send({ to: r.email, subject, text })),
    );
    let failed = 0;
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') return;
      failed += 1;
      this.logger.warn(`staff email to ${to[i].id} failed: ${withoutAddresses(result.reason)}`);
    });
    this.logger.log(
      `staff email ${req.toggle} ${req.path}: ${req.accountIds.length} accounts, ` +
        `${req.accountIds.length - wanted.length} switched off, ` +
        `${wanted.length - staff.length} not active staff, ` +
        `${staff.length - to.length} without an address, ${to.length - failed} sent, ${failed} failed`,
    );
    return { sent: to.length - failed, failed, skipped: req.accountIds.length - to.length };
  }
}
