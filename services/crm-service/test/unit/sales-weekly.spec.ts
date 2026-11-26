import { ServiceUnavailableException } from '@nestjs/common';

import { LegalEntityAudienceHttpAdapter } from '../../src/infrastructure/http/legal-entity-audience.http.adapter';
import { SalesWeeklyService } from '../../src/application/services/sales-weekly.service';
import { NotificationEvent, STAFF_TOGGLE_FOR_EVENT, PERSONAL_OPS_EVENTS } from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { weekLabel, weekRefusal } from '../../src/domain/sales-weekly';

// 2026-11-30 is a Monday (WIB). 07:00 WIB = 00:00 UTC.
const at = (iso: string) => new Date(iso);

describe('weekRefusal', () => {
  it('accepts the week that just ended, from the next Monday until that week\'s Sunday', () => {
    expect(weekRefusal('2026-11-23', at('2026-11-29T17:00:00Z'))).toBeNull(); // Mon 30 Nov 00:00 WIB
    expect(weekRefusal('2026-11-23', at('2026-12-06T10:00:00Z'))).toBeNull(); // Sun 6 Dec WIB
  });
  it('refuses a week still running, a week that is too old, a non-Monday and an impossible day', () => {
    expect(weekRefusal('2026-11-23', at('2026-11-29T10:00:00Z'))).toMatch(/just ended/); // Sun 29 Nov WIB
    expect(weekRefusal('2026-11-23', at('2026-12-06T17:00:00Z'))).toMatch(/just ended/); // Mon 7 Dec WIB
    expect(weekRefusal('2026-11-24', at('2026-11-30T00:00:00Z'))).toMatch(/Monday/);
    expect(weekRefusal('2026-02-31', at('2026-03-09T00:00:00Z'))).toMatch(/calendar day/);
  });
});

describe('weekLabel', () => {
  it('says the Monday and the closing Sunday, across a month', () => {
    expect(weekLabel('2026-11-23')).toBe('23 Nov - 29 Nov');
    expect(weekLabel('2026-11-30')).toBe('30 Nov - 6 Des');
  });
});

describe('the SALES_WEEKLY_REPORT event', () => {
  it('has its switch, its email and is a personal ops row', () => {
    expect(STAFF_TOGGLE_FOR_EVENT[NotificationEvent.SALES_WEEKLY_REPORT]).toBe('salesWeekly');
    expect(STAFF_EMAIL_TEMPLATES[NotificationEvent.SALES_WEEKLY_REPORT]?.body).toContain('{{link}}');
    expect(PERSONAL_OPS_EVENTS).toContain(NotificationEvent.SALES_WEEKLY_REPORT);
  });
});

describe('SalesWeeklyService', () => {
  const E = '22222222-2222-4222-8222-222222222222';
  const build = (over: { origin?: string; audience?: unknown; notify?: jest.Mock } = {}) => {
    const notify = over.notify ?? jest.fn(async () => ({}));
    const entities = { audienceOf: jest.fn(async () => over.audience ?? { name: 'PT A', active: true, aiReadRoles: ['MARKETING', 'MARKETING'] }) };
    const directory = {
      staffIdsByRoles: jest.fn(async () => ['a', 'b']),
      // b was moved to another role after the id read: the re-check drops it
      rolesOf: jest.fn(async () => new Map([['a', 'MARKETING'], ['b', 'FINANCE']])),
      profileOf: jest.fn(),
    };
    const config = { aiWebUrl: over.origin ?? 'https://ai.test' };
    const service = new SalesWeeklyService({ notify } as never, config as never, directory as never, entities as never);
    return { service, notify, entities, directory };
  };

  it('tells the people still holding a qualifying role, keyed by event, entity and person', async () => {
    const { service, notify } = build();
    const res = await service.run('sales-weekly:2026-11-23', '2026-11-23', [E]);
    expect(res).toMatchObject({ recipients: 1, notified: 1, unknownEntities: 0 });
    expect(notify).toHaveBeenCalledWith(
      NotificationEvent.SALES_WEEKLY_REPORT,
      '',
      { week: '23 Nov - 29 Nov', entity: 'PT A', link: `https://ai.test/calon-mitra/laporan?minggu=2026-11-23&be=${E}` },
      'a',
      null,
      `sales-weekly:2026-11-23:${E}:a`,
    );
  });

  it('skips a switched-off entity, counts it, and asks the directory for each role once', async () => {
    const off = build({ audience: { name: 'PT Off', active: false, aiReadRoles: ['MARKETING'] } });
    expect(await off.service.run('x', '2026-11-23', [E])).toMatchObject({ inactiveEntities: 1, recipients: 0, notified: 0 });
    expect(off.notify).not.toHaveBeenCalled();
    const dup = build();
    dup.directory.staffIdsByRoles.mockResolvedValue(['a', 'a', 'b']);
    await dup.service.run('x', '2026-11-23', [E]);
    expect(dup.directory.staffIdsByRoles).toHaveBeenCalledWith(['MARKETING']);
    expect(dup.notify).toHaveBeenCalledTimes(1);
  });

  it('answers 503 without AI_WEB_URL, when a read fails, and when a recipient could not be filed', async () => {
    await expect(build({ origin: '' }).service.run('x', '2026-11-23', [E])).rejects.toBeInstanceOf(ServiceUnavailableException);
    const down = build();
    down.entities.audienceOf.mockRejectedValue(new Error('depot down'));
    await expect(down.service.run('x', '2026-11-23', [E])).rejects.toBeInstanceOf(ServiceUnavailableException);
    const bad = build({ notify: jest.fn().mockRejectedValue(new Error('db')) });
    await expect(bad.service.run('x', '2026-11-23', [E])).rejects.toThrow(/could not be told/);
  });
});

describe('LegalEntityAudienceHttpAdapter', () => {
  const adapter = (url = 'http://depot', key = 'k') =>
    new LegalEntityAudienceHttpAdapter({ depotServiceUrl: url, internalServiceKey: key } as never);
  const answer = (status: number, body: unknown = {}) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: status < 300, status, json: async () => body } as Response);
  afterEach(() => jest.restoreAllMocks());

  it('reads the entity name and AI-read roles with the internal key', async () => {
    const f = answer(200, { name: ' PT A ', active: false, aiReadRoles: ['MARKETING', 7] });
    expect(await adapter().audienceOf('e1')).toEqual({ name: 'PT A', active: false, aiReadRoles: ['MARKETING'] });
    expect(f.mock.calls[0]![1]).toMatchObject({ headers: { 'x-internal-key': 'k' } });
  });
  it('reads a 404 as not an entity and throws on anything else, a malformed answer or no config', async () => {
    answer(404);
    expect(await adapter().audienceOf('e1')).toBeNull();
    answer(500);
    await expect(adapter().audienceOf('e1')).rejects.toThrow('500');
    answer(200, { name: '', active: true, aiReadRoles: [] });
    await expect(adapter().audienceOf('e1')).rejects.toThrow('without a name');
    answer(200, { name: 'PT A', aiReadRoles: [] });
    await expect(adapter().audienceOf('e1')).rejects.toThrow('active flag');
    await expect(adapter('', '').audienceOf('e1')).rejects.toThrow('missing');
  });
});
