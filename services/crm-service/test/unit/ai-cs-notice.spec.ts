import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiCsNoticeService } from '../../src/application/services/ai-cs-notice.service';
import { aiCsEventIdPattern, isCsRecipient } from '../../src/domain/ai-cs-notice';
import { NotificationEvent } from '../../src/domain/notification-event';
import { AiCsNoticeController } from '../../src/modules/ai-cs-notice.controller';
import { AiCsNoticeDto } from '../../src/modules/dto/notification.dto';

const CONV = '7c1f0f64-0b6e-4f4e-9d6a-2f3f7c9a1b11';
const DTO = { eventId: `ai-cs:${CONV}`, kind: 'NEW' as const, conversationId: CONV };

function build(over: { origin?: string; notify?: jest.Mock; idsErr?: boolean } = {}) {
  const notify = over.notify ?? jest.fn(async () => ({}));
  const directory = {
    staffIdsByRoles: over.idsErr ? jest.fn().mockRejectedValue(new Error('down')) : jest.fn(async () => ['h1', 'd1', 'x1', 'h1']),
    rolesOf: jest.fn(async () => new Map([['h1', 'HEAD_OFFICE'], ['d1', 'DIREKTUR']])), // x1 moved away
  };
  const service = new AiCsNoticeService({ notify } as never, { aiWebUrl: over.origin ?? 'https://ai.test' } as never, directory as never);
  return { service, notify, directory };
}

describe('AiCsNoticeService', () => {
  it('tells the CS readers, one row each, with the thread link and no customer data', async () => {
    const { service, notify, directory } = build();
    expect(await service.run(DTO)).toEqual({ recipients: 1, notified: 1, whatsapp: 'pending' });
    expect(notify).toHaveBeenCalledWith(NotificationEvent.AI_CS_NEW, '', { link: `https://ai.test/cs/${CONV}` }, 'h1', null, `${DTO.eventId}:h1`);
    expect(directory.staffIdsByRoles.mock.calls[0]![0]).toEqual(expect.arrayContaining(['HEAD_OFFICE', 'SUPER_ADMIN']));
    expect(directory.staffIdsByRoles.mock.calls[0]![0]).not.toContain('DIREKTUR');
  });

  it('sends ESCALATE to the CS managers (Direksi too) and REMIND to the readers', async () => {
    const a = build();
    await a.service.run({ ...DTO, kind: 'ESCALATE', eventId: `ai-cs-overdue:${CONV}:ESCALATE` });
    expect(a.notify.mock.calls.map((c) => [c[0], c[3]])).toEqual([
      [NotificationEvent.AI_CS_ESCALATE, 'h1'],
      [NotificationEvent.AI_CS_ESCALATE, 'd1'],
    ]);
    const b = build();
    await b.service.run({ ...DTO, kind: 'REMIND', eventId: `ai-cs-overdue:${CONV}:REMIND` });
    expect(b.notify.mock.calls.map((c) => [c[0], c[3]])).toEqual([[NotificationEvent.AI_CS_REMIND, 'h1']]);
  });

  it('answers 503 without AI_WEB_URL, when the directory fails, and when a recipient could not be filed', async () => {
    await expect(build({ origin: 'http://insecure' }).service.run(DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(build({ idsErr: true }).service.run(DTO)).rejects.toThrow(/recipients could not be read/);
    await expect(build({ notify: jest.fn().mockRejectedValue(new Error('db')) }).service.run(DTO)).rejects.toThrow(/could not be told/);
  });

  it('knows the audience of each kind', () => {
    expect(isCsRecipient('NEW', 'HEAD_OFFICE')).toBe(true);
    expect(isCsRecipient('NEW', 'DIREKTUR')).toBe(false);
    expect(isCsRecipient('REMIND', 'MARKETING')).toBe(false);
    expect(isCsRecipient('ESCALATE', 'DIREKTUR')).toBe(true);
    expect(isCsRecipient('ESCALATE', 'MANAGER')).toBe(false);
  });
});

describe('AiCsNoticeController', () => {
  const make = () => {
    const run = jest.fn(async () => ({ recipients: 1, notified: 1, whatsapp: 'pending' as const }));
    return { run, controller: new AiCsNoticeController({ run } as never) };
  };

  it('hands a notice whose eventId matches its kind and chat to the service, with or without a round', async () => {
    const { controller, run } = make();
    await controller.aiCsNotice(DTO);
    await controller.aiCsNotice({ ...DTO, kind: 'REMIND', eventId: `ai-cs-overdue:${CONV}:REMIND` });
    await controller.aiCsNotice({ ...DTO, eventId: `${DTO.eventId}:2` });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('refuses an eventId that is not its kind and chat', async () => {
    const { controller, run } = make();
    for (const bad of [{ eventId: 'ai-cs:other' }, { kind: 'ESCALATE' as const }, { eventId: `${DTO.eventId}:x` }, { eventId: `ai-cs-overdue:${CONV}:REMIND` }]) {
      await expect(controller.aiCsNotice({ ...DTO, ...bad })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(run).not.toHaveBeenCalled();
    expect(aiCsEventIdPattern('NEW', CONV).test(DTO.eventId)).toBe(true);
  });
});

describe('AiCsNoticeDto', () => {
  const check = async (over: Record<string, unknown>) => validate(plainToInstance(AiCsNoticeDto, { ...DTO, ...over }));

  it('lower-cases the id and refuses a stray shape', async () => {
    const dto = plainToInstance(AiCsNoticeDto, { ...DTO, conversationId: CONV.toUpperCase() });
    expect(await validate(dto)).toEqual([]);
    expect(dto.conversationId).toBe(CONV);
    expect((await check({ kind: 'NOPE' })).length).toBe(1);
    expect((await check({ conversationId: 'x' })).length).toBe(1);
    expect((await check({ eventId: 'has space' })).length).toBe(1);
  });
});
