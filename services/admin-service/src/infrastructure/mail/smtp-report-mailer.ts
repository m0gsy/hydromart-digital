import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import { ReportMail, ReportMailer } from '../../application/ports/report-mailer.port';
import { StaffMail, StaffMailer } from '../../application/ports/staff-mailer.port';
import { AdminConfigService } from '../../config/admin-config.service';

type Smtp = NonNullable<AdminConfigService['smtp']>;

/** One connection per message, from the SMTP_* settings: implicit TLS on 465, STARTTLS otherwise. */
const smtpTransport = (smtp: Smtp) =>
  createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    // nodemailer waits 2 min to connect and 10 min on a quiet socket by default: a stuck server must not hold a send that long.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

@Injectable()
export class SmtpReportMailer implements ReportMailer {
  private readonly logger = new Logger(SmtpReportMailer.name);

  constructor(private readonly config: AdminConfigService) {}

  async send(mail: ReportMail): Promise<boolean> {
    const smtp = this.config.smtp;
    if (!smtp) {
      this.logger.warn('SMTP not configured; scheduled report not emailed');
      return false;
    }
    try {
      await smtpTransport(smtp).sendMail({
        from: smtp.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.subject,
        attachments: [{ filename: mail.fileName, content: mail.content }],
      });
      return true;
    } catch (error) {
      this.logger.warn(`scheduled report email failed: ${(error as Error).message}`);
      return false;
    }
  }
}

/** The staff email, through the same SMTP as the reports. Text only: nothing in it is HTML. */
@Injectable()
export class SmtpStaffMailer implements StaffMailer {
  constructor(private readonly config: AdminConfigService) {}

  async send(mail: StaffMail): Promise<void> {
    const smtp = this.config.smtp;
    if (!smtp) throw new Error('SMTP not configured');
    // Named fields only: no cc/bcc/html can ride along on whatever object a caller passes.
    await smtpTransport(smtp).sendMail({
      from: smtp.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}
