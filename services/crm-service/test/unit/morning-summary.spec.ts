import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ApproverDirectoryPort } from '../../src/application/ports/approver-directory.port';
import { PendingApprovalsPort, PendingQueueAnswer } from '../../src/application/ports/pending-approvals.port';
import { StaffEmail } from '../../src/application/ports/staff-email.port';
import { MorningSummaryService } from '../../src/application/services/morning-summary.service';
import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { MORNING_SUMMARY_ROLES, summaryOf, wibDate } from '../../src/domain/morning-summary';
import { destinationFor } from '../../src/domain/notification-destination';
import {
  NotificationEvent,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { PendingApprovalsHttpAdapter } from '../../src/infrastructure/http/pending-approvals.http.adapter';
import { MorningSummaryDto } from '../../src/modules/dto/notification.dto';
import { NotificationExternalController } from '../../src/modules/notification-external.controller';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * AI-9: the Direksi morning summary. n8n only triggers; the recipients and the counts are
 * hydromart's own, one notification each, nothing for someone with nothing waiting.
 */
const q = (key: string, count: number | null, oldestAt: string | null, href: string, error?: 'unavailable') =>
  ({ key, count, oldestAt, href, ...(error ? { error } : {}) }) as PendingQueueAnswer;

const QUEUES: PendingQueueAnswer[] = [
  q('priceOverrides', 2, '2026-11-20T01:00:00.000Z', '/hq/pricing'),
  q('leave', 1, '2026-11-12T17:30:00.000Z', '/hr/leave'),
  q('refunds', 0, null, '/hq/refunds'),
];

describe('summaryOf', () => {
  it('names the queues with something waiting and says since when, in WIB', () => {
    // 17:30 UTC on the 12th is already the 13th in Jakarta.
    expect(summaryOf(QUEUES)).toEqual({
      summary: 'Usulan harga 2, Cuti 1',
      oldest: ' Tertua sejak 13 Nov.',
      href: '/hq/pricing',
    });
  });

  it('is nothing at all when nothing waits, so nobody is bothered', () => {
    expect(summaryOf([])).toBeNull();
    expect(summaryOf([q('leave', 0, null, '/hr/leave')])).toBeNull();
  });

  it('says an unreadable queue as unreadable, never as 0, beside the ones that could be read', () => {
    expect(summaryOf([q('leave', 3, '2026-11-20T01:00:00.000Z', '/hr/leave'), q('refunds', null, null, '/hq/refunds', 'unavailable')]))
      .toMatchObject({ summary: 'Cuti 3, Refund belum terbaca', href: '/hr/leave' });
    // Nothing readable waits: nothing real to say yet, so it is a failure to retry, not a row.
    expect(() => summaryOf([q('refunds', null, null, '/hq/refunds', 'unavailable'), q('leave', 0, null, '/hr/leave')])).toThrow(
      /no queue could be read/,
    );
  });

  it('opens the queue with the most waiting, the first on a tie, and names an unknown queue as it came', () => {
    expect(summaryOf([q('kasbon', 4, null, '/hr/loans/requests'), q('leave', 4, null, '/hr/leave')])?.href).toBe(
      '/hr/loans/requests',
    );
    expect(summaryOf([q('newQueue', 1, null, '/x')])?.summary).toBe('newQueue 1');
  });
});

describe('wibDate', () => {
  it('is the Jakarta calendar day, seven hours ahead of UTC', () => {
    expect(wibDate(new Date('2026-11-24T16:59:59.000Z'))).toBe('2026-11-24');
    expect(wibDate(new Date('2026-11-24T17:00:00.000Z'))).toBe('2026-11-25');
  });
});

describe('the MORNING_SUMMARY event', () => {
  it('reads the same in both languages and carries only counts', () => {
    const vars = { summary: 'Usulan harga 2, Cuti 1', oldest: ' Tertua sejak 13 Nov.' };
    expect(renderMessage(templateFor(NotificationEvent.MORNING_SUMMARY, 'id'), vars)).toBe(
      'Persetujuan yang menunggu Anda: Usulan harga 2, Cuti 1. Tertua sejak 13 Nov.',
    );
    expect(renderMessage(templateFor(NotificationEvent.MORNING_SUMMARY, 'en'), vars)).toBe(
      'Approvals waiting for you: Usulan harga 2, Cuti 1. Tertua sejak 13 Nov.',
    );
  });

  it('is for its recipient only, on its own switch, with an email and a tap to the biggest queue', () => {
    expect(PERSONAL_OPS_EVENTS).toContain(NotificationEvent.MORNING_SUMMARY);
    expect(STAFF_TOGGLE_FOR_EVENT[NotificationEvent.MORNING_SUMMARY]).toBe('morningSummary');
    expect(STAFF_EMAIL_TEMPLATES[NotificationEvent.MORNING_SUMMARY]).toEqual({
      subject: expect.any(String),
      body: expect.stringContaining('{{summary}}'),
    });
    expect(destinationFor(NotificationEvent.MORNING_SUMMARY, { href: '/hr/leave' })).toBe('/hr/leave');
    // An href that is not a plain app path is never followed.
    expect(destinationFor(NotificationEvent.MORNING_SUMMARY, { href: 'https://evil.test/x' })).not.toContain('evil');
    expect(destinationFor(NotificationEvent.MORNING_SUMMARY, {})).not.toContain('undefined');
  });

  it('is asked of the Direksi, in one constant that is easy to change', () => {
    expect(MORNING_SUMMARY_ROLES).toEqual(['DIREKTUR']);
  });
});

/** The service over the REAL NotificationService and an in-memory repo; only the directories are fakes. */
function build(answers: Record<string, PendingQueueAnswer[] | Error>, staff: Record<string, string> = { 'di-1': 'DIREKTUR', 'di-2': 'DIREKTUR' }) {
  const pushed: string[] = [];
  const emailed: StaffEmail[] = [];
  const repo = new InMemoryNotificationRepository();
  const notifications = new NotificationService(
    repo,
    { sendToCustomer: async (id: string) => (pushed.push(id), { devices: 1, delivered: 1 }) } as unknown as PushService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { send: async (e: StaffEmail) => void emailed.push(e) },
  );
  const directory: ApproverDirectoryPort = {
    staffIdsByRoles: jest.fn(async (roles: readonly string[]) =>
      Object.keys(staff).filter((id) => roles.includes(staff[id]!)),
    ),
    rolesOf: async (ids) => new Map(ids.filter((i) => staff[i]).map((i) => [i, staff[i]!])),
    profileOf: async () => null,
  };
  const forAccount = jest.fn(async (id: string) => {
    const a = answers[id] ?? [];
    if (a instanceof Error) throw a;
    return a;
  });
  const service = new MorningSummaryService(notifications, directory, { forAccount } as PendingApprovalsPort);
  return { service, repo, pushed, emailed, forAccount, directory };
}
const drain = () => new Promise((r) => setImmediate(r));
const EVENT = 'morning-summary:2026-11-25';

describe('MorningSummaryService', () => {
  it("files one row per recipient with that person's own counts, and emails and pushes them", async () => {
    const { service, repo, pushed, emailed, forAccount } = build({
      'di-1': QUEUES,
      'di-2': [q('kasbon', 5, '2026-11-21T01:00:00.000Z', '/hr/loans/requests')],
    });
    await expect(service.run(EVENT, '2026-11-25')).resolves.toEqual({
      date: '2026-11-25',
      recipients: 2,
      notified: 2,
      nothingWaiting: 0,
      whatsapp: 'pending',
    });
    await drain();
    expect(forAccount).toHaveBeenCalledWith('di-1', 'DIREKTUR');
    const byAccount = Object.fromEntries(repo.records.map((r) => [r.customerId, r]));
    expect(byAccount['di-1']).toMatchObject({
      event: 'MORNING_SUMMARY',
      phone: '',
      depotId: null,
      destination: '/hq/pricing',
      message: 'Persetujuan yang menunggu Anda: Usulan harga 2, Cuti 1. Tertua sejak 13 Nov.',
    });
    expect(byAccount['di-2']).toMatchObject({
      destination: '/hr/loans/requests',
      message: 'Persetujuan yang menunggu Anda: Kasbon 5. Tertua sejak 21 Nov.',
    });
    expect(pushed.sort()).toEqual(['di-1', 'di-2']);
    expect(emailed.map((e) => e.accountIds)).toEqual([['di-1'], ['di-2']]);
    expect(emailed[0]).toMatchObject({ toggle: 'morningSummary', path: '/hq/pricing' });
    expect(emailed[0]!.text).toContain('Usulan harga 2, Cuti 1');
  });

  it('sends nothing to a recipient with nothing waiting', async () => {
    const { service, repo, pushed, emailed } = build({ 'di-1': [q('leave', 0, null, '/hr/leave')], 'di-2': [] });
    await expect(service.run(EVENT, '2026-11-25')).resolves.toMatchObject({ notified: 0, nothingWaiting: 2 });
    await drain();
    expect([repo.records.length, pushed.length, emailed.length]).toEqual([0, 0, 0]);
  });

  it('files nothing twice for a retry or a replay of the same trigger', async () => {
    const { service, repo, pushed, emailed } = build({ 'di-1': QUEUES, 'di-2': QUEUES });
    await service.run(EVENT, '2026-11-25');
    await service.run(EVENT, '2026-11-25');
    await drain();
    expect(repo.records).toHaveLength(2);
    expect(pushed).toHaveLength(2);
    expect(emailed).toHaveLength(2);
    // The next day is a new event.
    await service.run('morning-summary:2026-11-26', '2026-11-26');
    expect(repo.records).toHaveLength(4);
  });

  it('says an unreadable queue in the notification itself', async () => {
    const { service, repo } = build({ 'di-1': [q('refunds', null, null, '/hq/refunds', 'unavailable'), q('leave', 1, null, '/hr/leave')] });
    await service.run(EVENT, '2026-11-25');
    expect(repo.records[0]!.message).toBe('Persetujuan yang menunggu Anda: Cuti 1, Refund belum terbaca.');
  });

  it('asks only accounts that hold a recipient role now', async () => {
    const { service, forAccount } = build({ 'di-1': QUEUES }, { 'di-1': 'DIREKTUR', 'ho-1': 'HEAD_OFFICE' });
    await service.run(EVENT, '2026-11-25');
    expect(forAccount.mock.calls.map((c) => c[0])).toEqual(['di-1']);
  });

  it('refuses with 503 when a recipient cannot be summarised, yet keeps the others for the retry to complete', async () => {
    const { service, repo, forAccount } = build({ 'di-1': new Error('dashboard down'), 'di-2': QUEUES });
    await expect(service.run(EVENT, '2026-11-25')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.records.map((r) => r.customerId)).toEqual(['di-2']);
    forAccount.mockImplementation(async () => QUEUES);
    await service.run(EVENT, '2026-11-25');
    expect(repo.records.map((r) => r.customerId).sort()).toEqual(['di-1', 'di-2']);
  });

  it('files nothing for a recipient none of whose queues could be read, so the retry can file the real one', async () => {
    const answers: Record<string, PendingQueueAnswer[]> = {
      'di-1': [q('refunds', null, null, '/hq/refunds', 'unavailable'), q('leave', 0, null, '/hr/leave')],
      'di-2': QUEUES,
    };
    const { service, repo, forAccount } = build(answers);
    await expect(service.run(EVENT, '2026-11-25')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.records.map((r) => r.customerId)).toEqual(['di-2']);
    answers['di-1'] = [q('leave', 2, '2026-11-20T01:00:00.000Z', '/hr/leave')];
    forAccount.mockImplementation(async (id: string) => answers[id]!);
    await expect(service.run(EVENT, '2026-11-25')).resolves.toMatchObject({ notified: 2 });
    expect(repo.records.find((r) => r.customerId === 'di-1')!.message).toContain('Cuti 2');
  });

  it('skips an account whose role the directory cannot tell', async () => {
    const { service, directory, forAccount } = build({ 'di-1': QUEUES });
    directory.rolesOf = async () => new Map();
    await expect(service.run(EVENT, '2026-11-25')).resolves.toMatchObject({ recipients: 0 });
    expect(forAccount).not.toHaveBeenCalled();
  });

  it('refuses with 503 when the recipients cannot be read', async () => {
    const { service, repo, directory } = build({});
    (directory.staffIdsByRoles as jest.Mock).mockRejectedValue(new Error('auth down'));
    await expect(service.run(EVENT, '2026-11-25')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.records).toHaveLength(0);
  });
});

describe('NotificationExternalController.morningSummaryRun', () => {
  const run = jest.fn(async () => ({ date: '2026-11-25', recipients: 1, notified: 1, nothingWaiting: 0, whatsapp: 'pending' as const }));
  const controller = new NotificationExternalController({} as never, { run } as never, {} as never, {} as never, {} as never);
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-25T00:30:00.000Z'));
    run.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('runs for today in Jakarta', async () => {
    await controller.morningSummaryRun({ eventId: EVENT, date: '2026-11-25' });
    expect(run).toHaveBeenCalledWith(EVENT, '2026-11-25');
  });

  it('refuses an eventId that is not its date, and a date that is not today in Jakarta', async () => {
    await expect(controller.morningSummaryRun({ eventId: 'morning-summary:2026-11-24', date: '2026-11-25' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.morningSummaryRun({ eventId: 'morning-summary:2026-11-24', date: '2026-11-24' })).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('MorningSummaryDto', () => {
  const errors = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(MorningSummaryDto, plain))).map((e) => e.property);

  it('takes the trigger as the contract sends it, and nothing else shaped wrongly', async () => {
    expect(await errors({ eventId: EVENT, date: '2026-11-25' })).toEqual([]);
    expect(await errors({ eventId: 'morning-summary:today', date: '2026-11-25' })).toEqual(['eventId']);
    expect(await errors({ eventId: EVENT, date: '25-11-2026' })).toEqual(['date']);
    expect(await errors({})).toEqual(['eventId', 'date']);
  });
});

describe('PendingApprovalsHttpAdapter', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const cfg = (over: Record<string, unknown> = {}) =>
    ({ dashboardServiceUrl: 'http://dash.test', internalServiceKey: 'k', ...over }) as never;
  afterEach(() => fetchMock.mockReset());

  it('asks dashboard-service for one account with the internal key and reads its queues', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        queues: [
          { key: 'leave', count: 2, oldestAt: '2026-11-20T01:00:00.000Z', href: '/hr/leave' },
          { key: 'refunds', count: null, oldestAt: null, href: '/hq/refunds', error: 'unavailable' },
          { key: 'kasbon', count: 'x', oldestAt: 5, href: '/hr/loans/requests' },
        ],
      }),
    } as never);
    const queues = await new PendingApprovalsHttpAdapter(cfg()).forAccount('a-1', 'DIREKTUR');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://dash.test/api/v1/dashboard/internal/pending-approvals?accountId=a-1&role=DIREKTUR');
    expect((init as RequestInit).headers).toMatchObject({ 'x-internal-key': 'k' });
    expect(queues).toEqual([
      { key: 'leave', count: 2, oldestAt: '2026-11-20T01:00:00.000Z', href: '/hr/leave' },
      { key: 'refunds', count: null, oldestAt: null, href: '/hq/refunds', error: 'unavailable' },
      // A count that is not a number is never read as 0.
      { key: 'kasbon', count: null, oldestAt: null, href: '/hr/loans/requests', error: 'unavailable' },
    ]);
  });

  it.each([
    ['a key that is not a plain name', { key: 'Cuti 99: klik', count: 1, oldestAt: null, href: '/hr/leave' }],
    ['a key that is not text', { key: 7, count: 1, oldestAt: null, href: '/hr/leave' }],
    ['an href that is not an app path', { key: 'leave', count: 1, oldestAt: null, href: 'https://evil.test' }],
  ])('throws on %s, so that recipient fails rather than a made-up line being sent', async (_label, queue) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ queues: [queue] }) } as never);
    await expect(new PendingApprovalsHttpAdapter(cfg()).forAccount('a', 'r')).rejects.toThrow('malformed');
  });

  it('says a queue it has no label for by its key, not dropped', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ queues: [{ key: 'newQueue', count: 1, oldestAt: null, href: '/x' }] }),
    } as never);
    await expect(new PendingApprovalsHttpAdapter(cfg()).forAccount('a', 'r')).resolves.toHaveLength(1);
  });

  it('throws when it is not configured, refused, or answered something malformed', async () => {
    await expect(new PendingApprovalsHttpAdapter(cfg({ dashboardServiceUrl: '' })).forAccount('a', 'r')).rejects.toThrow('missing');
    await expect(new PendingApprovalsHttpAdapter(cfg({ internalServiceKey: '' })).forAccount('a', 'r')).rejects.toThrow('missing');
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as never);
    await expect(new PendingApprovalsHttpAdapter(cfg()).forAccount('a', 'r')).rejects.toThrow('400');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as never);
    await expect(new PendingApprovalsHttpAdapter(cfg()).forAccount('a', 'r')).rejects.toThrow('malformed');
  });
});
