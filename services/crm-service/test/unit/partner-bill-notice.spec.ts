import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PartnerBillNoticeService } from '../../src/application/services/partner-bill-notice.service';
import { destinationFor } from '../../src/domain/notification-destination';
import {
  NotificationEvent,
  OPS_EVENTS,
  PERSONAL_OPS_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../src/domain/notification-event';
import { STAFF_EMAIL_TEMPLATES } from '../../src/domain/staff-email';
import { PartnerBillNoticeDto } from '../../src/modules/dto/notification.dto';
import { PartnerBillNoticeController } from '../../src/modules/partner-bill-notice.controller';

const BILL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const O1 = '11111111-1111-4111-8111-111111111111';
const O2 = '22222222-2222-4222-8222-222222222222';
const notice = {
  billId: BILL,
  monthLabel: 'Oktober 2026',
  legalEntityName: 'PT Mitra Air',
  totalIdr: 1500000,
  bank: { bankName: 'BCA', bankAccountNumber: '1234567890', bankAccountHolder: 'PT Indowater' },
  recipientIds: [O1, O2],
};

describe('PartnerBillNoticeService', () => {
  it('files one notice per owner with the amounts and the official account written in', async () => {
    const notifyOnce = jest.fn(async () => ({ created: true }));
    const out = await new PartnerBillNoticeService({ notifyOnce } as never).run(notice);
    expect(out).toEqual({ recipients: 2, notified: 2 });
    expect(notifyOnce).toHaveBeenCalledWith(
      NotificationEvent.PARTNER_BILL,
      '',
      expect.objectContaining({ month: 'Oktober 2026', entity: 'PT Mitra Air', number: '1234567890', holder: 'PT Indowater' }),
      O1,
      null,
      `partner-bill:${BILL}:${O1}`,
    );
    expect((notifyOnce.mock.calls[0] as unknown[])[2]).toMatchObject({ total: expect.stringMatching(/^Rp1[.,]500[.,]000$/) });
  });

  it('counts only what is new on a retry, and asks for another try when an owner could not be told', async () => {
    const again = jest.fn(async (_e: unknown, _p: unknown, _v: unknown, who: string) => ({ created: who === O2 }));
    expect(await new PartnerBillNoticeService({ notifyOnce: again } as never).run(notice)).toEqual({
      recipients: 2,
      notified: 1,
    });
    const flaky = jest.fn(async (_e: unknown, _p: unknown, _v: unknown, who: string) => {
      if (who === O1) throw new Error('db');
      return { created: true };
    });
    await expect(new PartnerBillNoticeService({ notifyOnce: flaky } as never).run(notice)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('works through a long list in batches', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const notifyOnce = jest.fn(async () => ({ created: true }));
    expect(await new PartnerBillNoticeService({ notifyOnce } as never).run({ ...notice, recipientIds: many })).toEqual({
      recipients: 12,
      notified: 12,
    });
  });
});

describe('PARTNER_BILL event', () => {
  it('is one owner’s own row with an email, on the approval switch, tapping through to their payout page', () => {
    const e = NotificationEvent.PARTNER_BILL;
    expect(OPS_EVENTS).toContain(e);
    expect(PERSONAL_OPS_EVENTS).toContain(e);
    expect(STAFF_TOGGLE_FOR_EVENT[e]).toBe('approval');
    expect(STAFF_EMAIL_TEMPLATES[e]?.body).toContain('{{holder}}');
    const vars = { month: 'Oktober 2026', entity: 'PT A', total: 'Rp1', bank: 'BCA', number: '123', holder: 'PT B' };
    expect(renderMessage(templateFor(e, 'id'), vars)).toBe(
      'Tagihan royalti Oktober 2026 untuk PT A: Rp1. Transfer ke BCA 123 a.n. PT B. Rincian di aplikasi.',
    );
    expect(renderMessage(templateFor(e, 'en'), vars)).toContain('Transfer to BCA 123');
    expect(destinationFor(e, {})).toBe('/dashboard/payout');
  });
});

describe('PartnerBillNoticeController', () => {
  it('hands the body to the service, and is open to the internal key only', async () => {
    const run = jest.fn(async () => ({ recipients: 2, notified: 2 }));
    const controller = new PartnerBillNoticeController({ run } as never);
    await expect(controller.partnerBill(notice as never)).resolves.toEqual({ recipients: 2, notified: 2 });
    const handler = PartnerBillNoticeController.prototype.partnerBill;
    expect(Reflect.getMetadata('path', handler)).toBe('internal/partner-bill');
    expect(Reflect.getMetadata('__guards__', handler).map((g: { name: string }) => g.name)).toEqual(['InternalAuthGuard']);
  });

  it('validates the body', async () => {
    expect(await validate(plainToInstance(PartnerBillNoticeDto, notice))).toEqual([]);
    for (const bad of [
      { ...notice, billId: 'nope' },
      { ...notice, totalIdr: 0 },
      { ...notice, totalIdr: 1.5 },
      { ...notice, bank: { ...notice.bank, bankAccountNumber: '12ab' } },
      { ...notice, bank: undefined },
      { ...notice, recipientIds: [O1, O1] },
      { ...notice, recipientIds: ['x'] },
      { ...notice, legalEntityName: '' },
    ]) {
      expect((await validate(plainToInstance(PartnerBillNoticeDto, bad))).length).toBeGreaterThan(0);
    }
  });
});
