import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import { ReportMail, ReportMailer } from '../../application/ports/report-mailer.port';
import { AdminConfigService } from '../../config/admin-config.service';

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
      await createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      }).sendMail({
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
