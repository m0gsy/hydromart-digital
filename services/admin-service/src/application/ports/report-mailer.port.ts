export interface ReportMail {
  to: string[];
  subject: string;
  fileName: string;
  content: Buffer;
}

/**
 * Mails a produced scheduled report. Fail-open: returns false (and logs) when SMTP is not
 * configured or the send fails — the file is already stored on the export log either way.
 */
export interface ReportMailer {
  send(mail: ReportMail): Promise<boolean>;
}
