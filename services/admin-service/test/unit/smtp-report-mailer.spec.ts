import { AdminConfigService } from '../../src/config/admin-config.service';
import { SmtpReportMailer, SmtpStaffMailer } from '../../src/infrastructure/mail/smtp-report-mailer';

const sendMail = jest.fn();
const createTransport = jest.fn((_o: unknown) => ({ sendMail }));
jest.mock('nodemailer', () => ({ createTransport: (o: unknown) => createTransport(o) }));

const mail = { to: ['a@b.c'], subject: 'Laporan', fileName: 'l.csv', content: Buffer.from('x') };
const smtp = { host: 'smtp.x', port: 587, user: 'u', pass: 'p', from: 'noreply@x' };
const mailer = (s: unknown) => new SmtpReportMailer({ smtp: s } as never);

describe('AdminConfigService.smtp', () => {
  const cfg = (env: Record<string, unknown>) =>
    new AdminConfigService({
      get: (k: string, d?: unknown) => env[k] ?? d,
    } as never);

  it('is null unless both host and from are set', () => {
    expect(cfg({}).smtp).toBeNull();
    expect(cfg({ SMTP_HOST: 'h' }).smtp).toBeNull();
  });

  it('builds the web origin for email links from WEB_DOMAIN, or none', () => {
    expect(cfg({ WEB_DOMAIN: ' hydromart-digital.com ' }).webOrigin).toBe('https://hydromart-digital.com');
    expect(cfg({}).webOrigin).toBe('');
  });

  it('reads host, port, credentials and from', () => {
    expect(cfg({ SMTP_HOST: 'h', SMTP_FROM: 'f@x', SMTP_PORT: '2525', SMTP_USER: 'u' }).smtp).toEqual(
      { host: 'h', port: 2525, user: 'u', pass: '', from: 'f@x' },
    );
  });
});

describe('SmtpReportMailer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is fail-open and sends nothing when SMTP is unconfigured', async () => {
    expect(await mailer(null).send(mail)).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends the file as an attachment', async () => {
    sendMail.mockResolvedValue({});
    expect(await mailer(smtp).send(mail)).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.x', secure: false, auth: { user: 'u', pass: 'p' } }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['a@b.c'],
        from: 'noreply@x',
        attachments: [{ filename: 'l.csv', content: mail.content }],
      }),
    );
  });

  it('uses implicit TLS on 465 and no auth when no user is set', async () => {
    sendMail.mockResolvedValue({});
    await mailer({ ...smtp, port: 465, user: '' }).send(mail);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, auth: undefined }),
    );
  });

  it('swallows a transport failure and reports false', async () => {
    sendMail.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await mailer(smtp).send(mail)).toBe(false);
  });
});

describe('SmtpStaffMailer', () => {
  const staff = (s: unknown) => new SmtpStaffMailer({ smtp: s } as never);
  const one = { to: 'ho-1@hydromart.id', subject: 'Lamaran waralaba baru', text: 'Isi' };
  beforeEach(() => jest.clearAllMocks());

  it('sends one plain-text message to one address, through the same SMTP as the reports', async () => {
    sendMail.mockResolvedValue({});
    // Anything else a caller's object carries stays behind: no cc, bcc or html.
    await staff(smtp).send({ ...one, cc: 'x@y', bcc: 'z@y', html: '<b>x</b>' } as never);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.x', port: 587, secure: false, auth: { user: 'u', pass: 'p' } }),
    );
    expect(sendMail).toHaveBeenCalledWith({ from: 'noreply@x', ...one });
  });

  it('throws when SMTP is not configured, and passes a transport refusal on', async () => {
    await expect(staff(null).send(one)).rejects.toThrow('SMTP not configured');
    expect(createTransport).not.toHaveBeenCalled();
    sendMail.mockRejectedValue(new Error('550 rejected'));
    await expect(staff(smtp).send(one)).rejects.toThrow('550 rejected');
  });
});
