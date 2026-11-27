import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { NotificationService } from '../../src/application/services/notification.service';
import { NotificationEvent } from '../../src/domain/notification-event';
import { AiLeadNoticeDto, FranchiseApplicationSubmittedDto } from '../../src/modules/dto/notification.dto';
import { NotificationExternalController } from '../../src/modules/notification-external.controller';

/*
 * AI-5: n8n forwards the signed franchise.application_submitted event here. The controller
 * checks the event and its application agree, makes city and province one line of visible
 * text, and files the notification with the eventId as its dedupe key.
 */

const APP = '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807';
const body = (over: Partial<FranchiseApplicationSubmittedDto> = {}): FranchiseApplicationSubmittedDto => ({
  eventId: `franchise.application_submitted:${APP}`,
  applicationId: APP,
  city: 'Bekasi',
  province: 'Jawa Barat',
  ...over,
});

function build() {
  const notify = jest.fn(async () => ({ id: 'row-1' }));
  const controller = new NotificationExternalController({ notify } as unknown as NotificationService, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { controller, notify };
}

describe('NotificationExternalController.franchiseApplicationSubmitted', () => {
  it('files the event for the reviewers, deduped on its eventId, and answers the row id', async () => {
    const { controller, notify } = build();
    await expect(controller.franchiseApplicationSubmitted(body())).resolves.toEqual({ id: 'row-1' });
    expect(notify).toHaveBeenCalledWith(
      NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED,
      '',
      { city: 'Bekasi', province: 'Jawa Barat', applicationId: APP },
      null,
      null,
      `franchise.application_submitted:${APP}`,
    );
  });

  it('reads one spelling, so an upper-case retry is the same event', async () => {
    const { controller, notify } = build();
    await controller.franchiseApplicationSubmitted(
      body({ eventId: `FRANCHISE.APPLICATION_SUBMITTED:${APP.toUpperCase()}`, applicationId: APP.toUpperCase() }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.anything(),
      '',
      expect.objectContaining({ applicationId: APP }),
      null,
      null,
      `franchise.application_submitted:${APP}`,
    );
  });

  it('refuses an eventId about another application', async () => {
    const { controller, notify } = build();
    const other = '00000000-0000-4000-8000-000000000000';
    await expect(
      controller.franchiseApplicationSubmitted(body({ eventId: `franchise.application_submitted:${other}` })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notify).not.toHaveBeenCalled();
  });

  it('makes city and province one line: control characters, tabs and newlines out', async () => {
    const { controller, notify } = build();
    await controller.franchiseApplicationSubmitted(
      body({ city: ' Kota\tBekasi\r\n\u0007', province: 'Jawa \u200bBa\u202erat\u2028\u00a0 ' }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.anything(),
      '',
      { city: 'Kota Bekasi', province: 'Jawa Barat', applicationId: APP },
      null,
      null,
      expect.any(String),
    );
  });

  it.each([
    ['city', { city: '\n\t \u200b' }],
    ['province', { province: '\u0000\u001b' }],
  ])('refuses a %s with nothing visible left', async (_field, over) => {
    const { controller, notify } = build();
    await expect(controller.franchiseApplicationSubmitted(body(over))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('FranchiseApplicationSubmittedDto', () => {
  const errors = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(FranchiseApplicationSubmittedDto, plain))).map((e) => e.property);

  it('takes the event as the contract sends it', async () => {
    expect(await errors({ ...body() })).toEqual([]);
  });

  it.each([
    ['an eventId of another event', { eventId: `order.created:${APP}` }],
    ['an eventId with no id', { eventId: 'franchise.application_submitted:' }],
    ['an eventId with junk after the id', { eventId: `franchise.application_submitted:${APP}x` }],
  ])('refuses %s', async (_label, over) => {
    expect(await errors({ ...body(), ...over })).toEqual(['eventId']);
  });

  it('refuses an applicationId that is not a UUID', async () => {
    expect(await errors({ ...body(), applicationId: 'app-1' })).toEqual(['applicationId']);
  });

  it('holds city and province to what the /waralaba form accepts', async () => {
    expect(await errors({ ...body(), city: '' })).toEqual(['city']);
    expect(await errors({ ...body(), province: 'x'.repeat(101) })).toEqual(['province']);
    expect(await errors({ ...body(), city: 7 })).toEqual(['city']);
    expect(await errors({ eventId: body().eventId, applicationId: APP })).toEqual(['city', 'province']);
  });
});

describe('NotificationExternalController.aiLeadNotice', () => {
  const PROSPECT = '7c1f0f64-0b6e-4f4e-9d6a-2f3f7c9a1b11';
  const dto = (over: Record<string, unknown> = {}) =>
    ({ eventId: `ai-lead:${PROSPECT}`, kind: 'NEW', prospectId: PROSPECT, legalEntityId: APP, city: 'Bekasi', province: 'Jawa Barat', ...over }) as never;
  const make = () => {
    const run = jest.fn(async () => ({ skipped: false, recipients: 1, notified: 1, whatsapp: 'pending' as const }));
    const n = {} as never;
    return { run, controller: new NotificationExternalController(n, n, n, n, n, n, n, n, { run } as never, n) };
  };

  it('hands a lead whose eventId matches its kind to the service', async () => {
    const { controller, run } = make();
    await controller.aiLeadNotice(dto());
    await controller.aiLeadNotice(dto({ kind: 'REMIND', eventId: `ai-lead-overdue:${PROSPECT}:REMIND` }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('refuses an eventId that is not its kind and prospect', async () => {
    const { controller, run } = make();
    await expect(controller.aiLeadNotice(dto({ eventId: 'ai-lead:other' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.aiLeadNotice(dto({ kind: 'ESCALATE' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('AiLeadNoticeDto', () => {
  const ok = { eventId: 'ai-lead:x', kind: 'NEW', prospectId: '7C1F0F64-0B6E-4F4E-9D6A-2F3F7C9A1B11', legalEntityId: APP, city: 'Bekasi', province: 'Jawa Barat' };
  const check = async (over: Record<string, unknown>) => validate(plainToInstance(AiLeadNoticeDto, { ...ok, ...over }));

  it('lower-cases ids and accepts a PIC', async () => {
    const dto = plainToInstance(AiLeadNoticeDto, { ...ok, picAccountId: APP.toUpperCase() });
    expect(await validate(dto)).toEqual([]);
    expect(dto.prospectId).toBe(dto.prospectId.toLowerCase());
    expect(dto.picAccountId).toBe(APP);
  });

  it('refuses a link as a place, an unknown kind and a stray id', async () => {
    expect((await check({ city: 'www.example.com' })).length).toBe(1);
    expect((await check({ province: '' })).length).toBeGreaterThan(0);
    expect((await check({ kind: 'NOPE' })).length).toBe(1);
    expect((await check({ legalEntityId: 'x' })).length).toBe(1);
  });
});
