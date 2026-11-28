import { ServiceUnavailableException } from '@nestjs/common';

import { AiLeadNoticeService } from '../../src/application/services/ai-lead-notice.service';
import { isLeadRole } from '../../src/domain/ai-lead-notice';
import { NotificationEvent } from '../../src/domain/notification-event';

const PROSPECT = '7c1f0f64-0b6e-4f4e-9d6a-2f3f7c9a1b11';
const ENTITY = '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807';
const DTO = { eventId: `ai-lead:${PROSPECT}`, kind: 'NEW' as const, prospectId: PROSPECT, legalEntityId: ENTITY, city: 'Bekasi', province: 'Jawa Barat' };

function build(over: { origin?: string; notify?: jest.Mock; audience?: unknown; entityErr?: boolean; idsErr?: boolean } = {}) {
  const notify = over.notify ?? jest.fn(async () => ({}));
  const audience = over.audience === undefined ? { name: 'PT HKP', active: true, aiReadRoles: ['MARKETING', 'DIREKTUR', 'MANAGER'] } : over.audience;
  const entities = { audienceOf: over.entityErr ? jest.fn().mockRejectedValue(new Error('down')) : jest.fn(async () => audience) };
  const directory = {
    staffIdsByRoles: over.idsErr ? jest.fn().mockRejectedValue(new Error('down')) : jest.fn(async () => ['m1', 'd1', 'x1']),
    rolesOf: jest.fn(async () => new Map([['m1', 'MARKETING'], ['d1', 'DIREKTUR']])), // x1 moved away
  };
  const service = new AiLeadNoticeService({ notify } as never, { aiWebUrl: over.origin ?? 'https://ai.test' } as never, directory as never, entities as never);
  return { service, notify, directory };
}

describe('AiLeadNoticeService', () => {
  it('tells the CRM roles of the entity a new lead, with the queue link and a per-person dedupe key', async () => {
    const { service, notify, directory } = build();
    expect(await service.run(DTO)).toEqual({ skipped: false, recipients: 1, notified: 1, whatsapp: 'pending' });
    expect(notify).toHaveBeenCalledWith(
      NotificationEvent.AI_LEAD_NEW, '', { city: 'Bekasi', province: 'Jawa Barat', link: 'https://ai.test/calon-mitra?antrean=1' },
      'm1', null, `${DTO.eventId}:${ENTITY}:m1`,
    );
    expect(directory.staffIdsByRoles.mock.calls[0]![0]).toEqual(['MARKETING']);
  });

  it('sends ESCALATE to Direksi (and prospectSettings holders) with the lead link', async () => {
    const { service, notify } = build();
    await service.run({ ...DTO, kind: 'ESCALATE', eventId: `ai-lead-overdue:${PROSPECT}:ESCALATE` });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe(NotificationEvent.AI_LEAD_ESCALATE);
    expect(notify.mock.calls[0]![3]).toBe('d1');
    expect(notify.mock.calls[0]![2].link).toBe(`https://ai.test/calon-mitra/${PROSPECT}`);
  });

  it('reminds the person on the lead alone, or the team when that person is not a recipient', async () => {
    const remind = { ...DTO, kind: 'REMIND' as const, eventId: `ai-lead-overdue:${PROSPECT}:REMIND` };
    const a = build();
    await a.service.run({ ...remind, picAccountId: 'm1' });
    expect(a.notify).toHaveBeenCalledTimes(1);
    const b = build();
    await b.service.run({ ...remind, picAccountId: 'gone' });
    expect(b.notify.mock.calls[0]![0]).toBe(NotificationEvent.AI_LEAD_REMIND);
    expect(b.notify).toHaveBeenCalledTimes(1); // MARKETING m1 only: DIREKTUR does not hold prospectCrm
  });

  it('answers skipped for an unknown or switched-off entity', async () => {
    for (const audience of [null, { name: 'x', active: false, aiReadRoles: [] }]) {
      const { service, notify } = build({ audience });
      expect(await service.run(DTO)).toEqual({ skipped: true, recipients: 0, notified: 0, whatsapp: 'pending' });
      expect(notify).not.toHaveBeenCalled();
    }
  });

  it('answers 503 without AI_WEB_URL, when a read fails, and when a recipient could not be filed', async () => {
    await expect(build({ origin: 'http://insecure' }).service.run(DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ entityErr: true }).service.run(DTO)).rejects.toThrow(/legal entity could not be read/);
    await expect(build({ idsErr: true }).service.run(DTO)).rejects.toThrow(/recipients could not be read/);
    await expect(build({ notify: jest.fn().mockRejectedValue(new Error('db')) }).service.run(DTO)).rejects.toThrow(/could not be told/);
  });

  it('knows the audience of each kind', () => {
    expect(isLeadRole('NEW', 'MARKETING')).toBe(true);
    expect(isLeadRole('NEW', 'DIREKTUR')).toBe(false);
    expect(isLeadRole('ESCALATE', 'DIREKTUR')).toBe(true);
    expect(isLeadRole('ESCALATE', 'MANAGER')).toBe(false);
  });
});
