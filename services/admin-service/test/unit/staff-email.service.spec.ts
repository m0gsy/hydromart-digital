import { Logger } from '@nestjs/common';

import { StaffAccount, StaffDirectoryPort } from '../../src/application/ports/staff-directory.port';
import { StaffHrEmailPort } from '../../src/application/ports/staff-hr-email.port';
import { StaffMail, StaffMailer } from '../../src/application/ports/staff-mailer.port';
import { AdminNotificationPrefService } from '../../src/application/services/admin-notification-pref.service';
import {
  StaffEmailRequest,
  StaffEmailService,
  staffEmailText,
} from '../../src/application/services/staff-email.service';
import { InMemoryAdminNotificationPrefRepository } from '../support/fakes';

/*
 * The email channel of staff notifications (owner rule 24 Nov 2026): crm hands over a filed
 * notification's copy and its recipients; each one gets their own message when their switch has
 * email on, their login is active staff and has an address. Nothing here is ever HTML.
 */
const SMTP = { host: 'mail.hydromart.id', port: 587, user: 'u', pass: 'p', from: 'noreply@hydromart.id' };
const ORIGIN = 'https://hydromart-digital.com';
const PATH = '/hq/applications/detail?id=3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807';
const TEXT = 'Lamaran waralaba baru dari calon mitra di Bekasi, Jawa Barat. Buka tautan di bawah untuk meninjaunya.';

const account = (id: string, over: Partial<StaffAccount> = {}): StaffAccount => ({
  id,
  email: `${id}@hydromart.id`,
  role: 'HEAD_OFFICE',
  status: 'ACTIVE',
  ...over,
});

const request = (accountIds: string[], over: Partial<StaffEmailRequest> = {}): StaffEmailRequest => ({
  accountIds,
  toggle: 'newFranchiseApp',
  subject: 'Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat',
  text: TEXT,
  path: PATH,
  ...over,
});

function build(
  opts: {
    smtp?: typeof SMTP | null;
    origin?: string;
    accounts?: StaffAccount[];
    mailer?: StaffMailer;
    hr?: StaffHrEmailPort;
  } = {},
) {
  const prefs = new AdminNotificationPrefService(new InMemoryAdminNotificationPrefRepository());
  const sent: StaffMail[] = [];
  const lookups: string[][] = [];
  const all = opts.accounts ?? [account('ho-1'), account('di-1', { role: 'DIREKTUR' })];
  const directory: StaffDirectoryPort = {
    accountsByIds: async (ids) => {
      lookups.push([...ids]);
      return all.filter((a) => ids.includes(a.id));
    },
  };
  const mailer: StaffMailer = opts.mailer ?? { send: async (mail) => void sent.push(mail) };
  const config = { smtp: opts.smtp === undefined ? SMTP : opts.smtp, webOrigin: opts.origin ?? ORIGIN };
  const hr: StaffHrEmailPort = opts.hr ?? { emailsByAccounts: async () => [] };
  return { service: new StaffEmailService(config as never, prefs, directory, hr, mailer), prefs, sent, lookups };
}

let log: jest.SpyInstance;
let warn: jest.SpyInstance;
beforeEach(() => {
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('StaffEmailService', () => {
  it('writes each person a message of their own, with the link and the switch line', async () => {
    const { service, sent } = build();
    await expect(service.send(request(['ho-1', 'di-1']))).resolves.toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(sent.map((m) => m.to)).toEqual(['ho-1@hydromart.id', 'di-1@hydromart.id']);
    expect(sent[0]).toEqual({
      to: 'ho-1@hydromart.id',
      subject: 'Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat',
      text: staffEmailText(TEXT, PATH, ORIGIN),
    });
    expect(log).toHaveBeenCalledWith(
      `staff email newFranchiseApp ${PATH}: 2 accounts, 0 switched off, 0 not active staff, 0 without an address, 0 sharing an address, 0 over the hourly cap, 2 sent, 0 failed`,
    );
  });

  it('keeps to the email switch: on by default, off once the person saves it off, whatever the push', async () => {
    const { service, prefs, sent, lookups } = build();
    await prefs.save('ho-1', [{ id: 'newFranchiseApp', push: true, email: false, wa: false }]);
    await prefs.save('di-1', [{ id: 'newFranchiseApp', push: false, email: true, wa: false }]);
    await expect(service.send(request(['ho-1', 'di-1']))).resolves.toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(sent.map((m) => m.to)).toEqual(['di-1@hydromart.id']);
    // A person who switched email off is not even looked up.
    expect(lookups).toEqual([['di-1']]);
  });

  it('skips, and counts, a login with no address, a customer, an inactive login and an unknown id', async () => {
    const { service, sent } = build({
      accounts: [
        account('ho-1', { email: null }),
        account('cu-1', { role: 'CUSTOMER' }),
        account('su-1', { status: 'SUSPENDED' }),
        account('di-1', { role: 'DIREKTUR' }),
      ],
    });
    await expect(service.send(request(['ho-1', 'cu-1', 'su-1', 'gone', 'di-1']))).resolves.toEqual({
      sent: 1,
      failed: 0,
      skipped: 4,
    });
    expect(sent.map((m) => m.to)).toEqual(['di-1@hydromart.id']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('3 not active staff, 1 without an address, 0 sharing an address'));
  });

  it('writes to any active staff role, not a customer or a franchise owner, each footer pointing at its own switch', async () => {
    const roles = ['STAFF_DEPOT', 'KEPALA_DEPOT', 'HEAD_OFFICE', 'DIREKTUR', 'C_kasir', 'CUSTOMER', 'FRANCHISE_OWNER'];
    const { service, sent } = build({ accounts: roles.map((role) => account(role, { role })) });
    await expect(service.send(request(roles))).resolves.toEqual({ sent: 5, failed: 0, skipped: 2 });
    expect(sent.map((m) => m.to)).toEqual(
      ['STAFF_DEPOT', 'KEPALA_DEPOT', 'HEAD_OFFICE', 'DIREKTUR', 'C_kasir'].map((r) => `${r}@hydromart.id`),
    );
    expect(sent[0].text).toBe(staffEmailText(TEXT, PATH, ORIGIN, '/dashboard/account'));
    expect(sent[0].text).toContain(`Ubah di ${ORIGIN}/dashboard/account.`);
    expect(sent[2].text).toBe(staffEmailText(TEXT, PATH, ORIGIN));
    expect(sent[2].text).toContain(`Ubah di ${ORIGIN}/hq/profile.`);
  });

  it('prefers the HR email over the login email, per person', async () => {
    const hr: StaffHrEmailPort = {
      emailsByAccounts: jest.fn(async () => [{ accountId: 'ho-1', email: 'hr-budi@hydromart.id' }]),
    };
    const { service, sent } = build({ hr });
    await service.send(request(['ho-1', 'di-1']));
    expect(sent.map((m) => m.to)).toEqual(['hr-budi@hydromart.id', 'di-1@hydromart.id']);
    expect(hr.emailsByAccounts).toHaveBeenCalledWith(['ho-1', 'di-1']);
  });

  it('uses the HR email for a login that has none, and does not ask HR when nobody is staff', async () => {
    const hr: StaffHrEmailPort = {
      emailsByAccounts: jest.fn(async () => [{ accountId: 'ho-1', email: 'hr@hydromart.id' }]),
    };
    const { service, sent } = build({ hr, accounts: [account('ho-1', { email: null }), account('cu-1', { role: 'CUSTOMER' })] });
    await service.send(request(['ho-1']));
    expect(sent.map((m) => m.to)).toEqual(['hr@hydromart.id']);
    await service.send(request(['cu-1']));
    expect(hr.emailsByAccounts).toHaveBeenCalledTimes(1);
  });

  it('writes one message to an address two accounts share, whatever its case', async () => {
    const { service, sent } = build({
      accounts: [account('ho-1', { email: 'Shared@hydromart.id' }), account('di-1', { email: 'shared@HYDROMART.id' })],
    });
    await expect(service.send(request(['ho-1', 'di-1']))).resolves.toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(sent).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 sharing an address'));
  });

  it('falls back to the login emails, with a warning that names no address, when HR cannot answer', async () => {
    const hr: StaffHrEmailPort = {
      emailsByAccounts: async () => {
        throw new Error('hr-service responded 503 for budi@hydromart.id');
      },
    };
    const { service, sent } = build({ hr });
    await expect(service.send(request(['ho-1', 'di-1']))).resolves.toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(sent.map((m) => m.to)).toEqual(['ho-1@hydromart.id', 'di-1@hydromart.id']);
    expect(warn).toHaveBeenCalledWith('hr-service email lookup failed, using login emails: hr-service responded 503 for <address>');
  });

  it('sends in batches of 3: never more than 3 sends open at once', async () => {
    let open = 0;
    let peak = 0;
    const ids = Array.from({ length: 7 }, (_, i) => `ho-${i}`);
    const { service } = build({
      accounts: ids.map((id) => account(id)),
      mailer: {
        send: async () => {
          open += 1;
          peak = Math.max(peak, open);
          await new Promise((r) => setImmediate(r));
          open -= 1;
        },
      },
    });
    await expect(service.send(request(ids))).resolves.toEqual({ sent: 7, failed: 0, skipped: 0 });
    expect(peak).toBe(3);
  });

  it('names the recipient whose send fails in a later batch, and keeps the counts exact', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `ho-${i}`);
    const { service } = build({
      accounts: ids.map((id) => account(id)),
      mailer: {
        send: async (mail) => {
          if (mail.to.startsWith('ho-4@')) throw new Error(`451 <${mail.to}> try later`);
        },
      },
    });
    await expect(service.send(request(ids))).resolves.toEqual({ sent: 4, failed: 1, skipped: 0 });
    expect(warn).toHaveBeenCalledWith('staff email to ho-4 failed: 451 <address> try later');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('4 sent, 1 failed'));
  });

  describe('hourly cap per toggle', () => {
    const ids = Array.from({ length: 121 }, (_, i) => `ho-${i}`);
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());

    it('skips the 121st message of the hour, warns once, and starts over after an hour', async () => {
      const { service, sent } = build({ accounts: ids.map((id) => account(id)) });
      await expect(service.send(request(ids))).resolves.toEqual({ sent: 120, failed: 0, skipped: 1 });
      expect(sent).toHaveLength(120);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('1 over the hourly cap, 120 sent'));
      // Still the same hour: nothing more goes out, and the warning is not repeated.
      await expect(service.send(request(['ho-0']))).resolves.toEqual({ sent: 0, failed: 0, skipped: 1 });
      expect(warn.mock.calls.filter(([m]) => String(m).includes('hourly cap'))).toHaveLength(1);
      jest.setSystemTime(Date.now() + 60 * 60 * 1000);
      await expect(service.send(request(['ho-0']))).resolves.toEqual({ sent: 1, failed: 0, skipped: 0 });
    });
  });

  it('looks nobody up when nobody has email on', async () => {
    const { service, prefs, sent, lookups } = build();
    await prefs.save('ho-1', [{ id: 'newFranchiseApp', push: true, email: false, wa: false }]);
    await expect(service.send(request(['ho-1']))).resolves.toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(lookups).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('without SMTP sends nothing, looks nothing up, and says so once per process', async () => {
    const { service, sent, lookups } = build({ smtp: null });
    await expect(service.send(request(['ho-1', 'di-1']))).resolves.toEqual({ sent: 0, failed: 0, skipped: 2 });
    await service.send(request(['ho-1']));
    expect(sent).toEqual([]);
    expect(lookups).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('SMTP not configured (SMTP_HOST or SMTP_FROM blank): staff email is not sent');
  });

  it('counts a refused send and logs its reason without the address, and still sends the rest', async () => {
    const sent: string[] = [];
    const { service } = build({
      mailer: {
        send: async (mail) => {
          if (mail.to.startsWith('ho-1')) {
            throw new Error(`550 5.1.1 <${mail.to}>: Recipient address rejected`);
          }
          sent.push(mail.to);
        },
      },
    });
    await expect(service.send(request(['ho-1', 'di-1']))).resolves.toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(sent).toEqual(['di-1@hydromart.id']);
    expect(warn).toHaveBeenCalledWith('staff email to ho-1 failed: 550 5.1.1 <address> Recipient address rejected');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 sent, 1 failed'));
    expect(JSON.stringify([...warn.mock.calls, ...log.mock.calls])).not.toContain('@');
  });

  it('sends the subject as one line whatever it was given', async () => {
    const { service, sent } = build();
    const zeroWidth = String.fromCharCode(0x200b);
    await service.send(request(['ho-1'], { subject: `Lamaran\r\nBcc: x\twaralaba${zeroWidth} baru ` }));
    expect(sent[0]!.subject).toBe('Lamaran Bcc: x waralaba baru');
  });

  it("leaves the applicant's words as they were typed, in a plain-text message", async () => {
    const { service, sent } = build();
    const typed = 'Lamaran waralaba baru dari calon mitra di <b>Bekasi</b> & <script>x</script>, Jawa Barat.';
    await service.send(request(['ho-1'], { text: typed }));
    expect(Object.keys(sent[0]!).sort()).toEqual(['subject', 'text', 'to']);
    expect(sent[0]!.text.startsWith(typed)).toBe(true);
  });
});

describe('staffEmailText', () => {
  it('adds the screen and the switch line under the web origin', () => {
    expect(staffEmailText(TEXT, PATH, ORIGIN)).toBe(
      `${TEXT}\n\n${ORIGIN}${PATH}\n\n` +
        'Email ini terkirim karena email untuk notifikasi ini menyala di profil Anda. ' +
        `Ubah di ${ORIGIN}/hq/profile.`,
    );
  });

  it('points at the path alone where the web has no public origin', () => {
    const text = staffEmailText(TEXT, PATH, '');
    expect(text).toContain(`\n\n${PATH}\n\n`);
    expect(text.endsWith('Ubah di /hq/profile.')).toBe(true);
  });
});
