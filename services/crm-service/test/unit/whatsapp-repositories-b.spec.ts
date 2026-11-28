import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { NotificationEvent } from '../../src/domain/notification-event';
import { WaTemplatePrismaRepository } from '../../src/infrastructure/prisma/wa-cap.prisma.repository';
import { WaConsentPrismaRepository } from '../../src/infrastructure/prisma/wa-consent.prisma.repository';
import { WaMessagePrismaRepository } from '../../src/infrastructure/prisma/wa-message.prisma.repository';
import { WaTransactionPrismaRepository } from '../../src/infrastructure/prisma/wa-transaction.prisma.repository';
import { InMemoryNotificationRepository } from '../support/fakes';

// The statements PR-B added to the repositories: pinned by shape, like the ones PR-A shipped.
const at = new Date('2026-11-29T03:00:00.000Z');

describe('WaMessagePrismaRepository (sender release)', () => {
  const waMessage = { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
  const repo = new WaMessagePrismaRepository({ waMessage } as never);
  beforeEach(() => jest.resetAllMocks());

  it('skips a row with its reason', async () => {
    await repo.markSkipped('m1', 'CAP');
    expect(waMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'SKIPPED', skipReason: 'CAP' } });
  });

  it('cancels only a row that is still QUEUED and says whether it did', async () => {
    waMessage.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.markCancelled('m1')).resolves.toBe(true);
    await expect(repo.markCancelled('m1')).resolves.toBe(false);
    expect(waMessage.updateMany).toHaveBeenCalledWith({ where: { id: 'm1', status: 'QUEUED' }, data: { status: 'CANCELLED' } });
  });

  describe('applyStatus: forward only', () => {
    beforeEach(() => waMessage.findUnique.mockResolvedValue({ id: 'm1', vars: { a: '1' }, status: 'SENT' }));

    it('answers null for a message that is not ours', async () => {
      waMessage.findUnique.mockResolvedValue(null);
      await expect(repo.applyStatus('wamid.x', 'READ', at, null)).resolves.toBeNull();
    });

    it.each([
      ['SENT', ['QUEUED'], 'sentAt'],
      ['DELIVERED', ['QUEUED', 'SENT'], 'deliveredAt'],
      ['READ', ['QUEUED', 'SENT', 'DELIVERED'], 'readAt'],
      ['FAILED', ['QUEUED', 'SENT'], 'failedAt'],
    ] as const)('%s may only replace %j', async (status, from, stamp) => {
      waMessage.updateMany.mockResolvedValue({ count: 1 });
      const out = await repo.applyStatus('wamid.1', status, at, status === 'FAILED' ? { code: '131026', text: 'x'.repeat(900) } : null);
      expect(out).toEqual({ record: expect.objectContaining({ id: 'm1', vars: { a: '1' } }), changed: true });
      const call = waMessage.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'm1', status: { in: from } });
      expect(call.data[stamp]).toBe(at);
      if (status === 'FAILED') {
        expect(call.data.errorCode).toBe('131026');
        expect(call.data.error).toHaveLength(500);
      }
    });

    it('a late or repeated report moves nothing', async () => {
      waMessage.updateMany.mockResolvedValue({ count: 0 });
      await expect(repo.applyStatus('wamid.1', 'SENT', at, null)).resolves.toMatchObject({ changed: false });
    });
  });

  it('finds the last free-text reply, ignoring refused ones', async () => {
    waMessage.findFirst.mockResolvedValueOnce({ createdAt: at }).mockResolvedValueOnce(null);
    await expect(repo.lastServiceReplyAt('6281')).resolves.toBe(at);
    await expect(repo.lastServiceReplyAt('6281')).resolves.toBeNull();
    expect(waMessage.findFirst.mock.calls[0][0].where).toEqual({ phone: '6281', category: 'SERVICE', status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] } });
  });

  it('lists failures and refusals for HQ without the NO_CONSENT noise', async () => {
    waMessage.findMany.mockResolvedValue([{ id: 'm1', vars: null }]);
    await expect(repo.listProblems(50)).resolves.toEqual([{ id: 'm1', vars: {} }]);
    expect(waMessage.findMany.mock.calls[0][0]).toMatchObject({
      where: { OR: [{ status: 'FAILED' }, { status: 'SKIPPED', skipReason: { not: 'NO_CONSENT' } }] },
      take: 50,
    });
  });
});

describe('WaConsentPrismaRepository (sender release)', () => {
  const waConsent = { findMany: jest.fn() };
  const waOptInCode = { findUnique: jest.fn() };
  const $executeRaw = jest.fn();
  const repo = new WaConsentPrismaRepository({ waConsent, waOptInCode, $executeRaw } as never);
  beforeEach(() => jest.resetAllMocks());

  it('reads many phones at once, bounded, and a code by id', async () => {
    waConsent.findMany.mockResolvedValue([]);
    waOptInCode.findUnique.mockResolvedValue({ id: 'k1' });
    await repo.listForPhones(['6281', '6282']);
    expect(waConsent.findMany).toHaveBeenCalledWith({ where: { phone: { in: ['6281', '6282'] } }, orderBy: { seq: 'asc' }, take: 5000 });
    await expect(repo.findCodeById('k1')).resolves.toEqual({ id: 'k1' });
    expect(waOptInCode.findUnique.mock.calls[0][0].where).toEqual({ id: 'k1' });
  });

  it('purges grants older than the cutoff but never a number whose newest row is a STOP', async () => {
    $executeRaw.mockResolvedValue(6);
    await expect(repo.purgeBefore(at)).resolves.toBe(6);
    const [strings, cutoff] = $executeRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(cutoff).toBe(at);
    expect(sql).toContain('DISTINCT ON ("phone")');
    expect(sql).toContain('ORDER BY "phone", "seq" DESC');
    expect(sql).toContain('n."granted" = true');
    expect(sql).toContain('n."recordedAt" < ?');
  });
});

describe('WaTemplatePrismaRepository.get', () => {
  it('reads one template by name and language', async () => {
    const waTemplate = { findUnique: jest.fn().mockResolvedValue({ name: 'n' }) };
    const repo = new WaTemplatePrismaRepository({ waTemplate } as never);
    await expect(repo.get('n', 'id')).resolves.toEqual({ name: 'n' });
    expect(waTemplate.findUnique).toHaveBeenCalledWith({ where: { name_language: { name: 'n', language: 'id' } } });
  });
});

describe('WaTransactionPrismaRepository', () => {
  it('hands the body the three repositories bound to the transaction client, and passes its result and its error through', async () => {
    const client = { waConsent: {}, waMessage: {}, waCostCounter: {}, waCap: {} };
    const $transaction = jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(client));
    const repo = new WaTransactionPrismaRepository({ $transaction } as never);
    let seen: Record<string, unknown> = {};
    await expect(repo.transaction(async (tx) => ((seen = tx), 'done'))).resolves.toBe('done');
    expect(Object.keys(seen).sort()).toEqual(['caps', 'consent', 'messages']);
    expect((seen.consent as { prisma: unknown }).prisma).toBe(client);
    await expect(repo.transaction(async () => Promise.reject(new Error('rollback')))).rejects.toThrow('rollback');
  });
});

// The hook: after the inbox row and the push, for a freshly filed customer row, and never able to cost the row.
describe('NotificationService hands a fresh customer row to WhatsApp', () => {
  const build = () => {
    const repo = new InMemoryNotificationRepository();
    const push = { sendToCustomer: jest.fn().mockResolvedValue({ devices: 0, delivered: 0 }) };
    const whatsapp = { enqueue: jest.fn().mockResolvedValue(undefined), phoneChanged: jest.fn() };
    const service = new NotificationService(repo, push as unknown as PushService, undefined, undefined, undefined, undefined, undefined, undefined, undefined, whatsapp);
    return { service, whatsapp, repo };
  };
  const vars = { name: 'Budi', orderNumber: 'HM-1' };

  it('enqueues once with the row id, the event key and the vars', async () => {
    const { service, whatsapp } = build();
    const record = await service.notify(NotificationEvent.ORDER_CONFIRMED, '', vars, 'c1', null, 'order-1:CONFIRMED');
    expect(whatsapp.enqueue).toHaveBeenCalledWith({ event: 'ORDER_CONFIRMED', customerId: 'c1', notificationId: record.id, dedupeKey: 'order-1:CONFIRMED', vars });
  });

  it('a repeat of the event (the key already had a row) enqueues nothing more, and neither does a staff or ops row', async () => {
    const { service, whatsapp } = build();
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '', vars, 'c1', null, 'k');
    await service.notify(NotificationEvent.ORDER_CONFIRMED, '', vars, 'c1', null, 'k');
    await service.notify(NotificationEvent.STOCK_LOW, '', { depot: 'D', item: 'G', quantity: '1', minimum: '5' }, null, 'd1');
    expect(whatsapp.enqueue).toHaveBeenCalledTimes(1);
  });

  it('PHONE_CHANGED tells WhatsApp the old number is gone, once, for a fresh row only', async () => {
    const repo = new InMemoryNotificationRepository();
    const whatsapp = { enqueue: jest.fn(), phoneChanged: jest.fn() };
    const service = new NotificationService(repo, { sendToCustomer: jest.fn() } as unknown as PushService, undefined, undefined, undefined, undefined, undefined, undefined, undefined, whatsapp);
    await service.notify(NotificationEvent.PHONE_CHANGED, '+6281234567890', { name: 'A', newPhone: '+62***1' }, null, null, 'pc-1');
    await service.notify(NotificationEvent.PHONE_CHANGED, '+6281234567890', { name: 'A', newPhone: '+62***1' }, null, null, 'pc-1');
    expect(whatsapp.phoneChanged).toHaveBeenCalledTimes(1);
    expect(whatsapp.phoneChanged).toHaveBeenCalledWith('+6281234567890');
    expect(whatsapp.enqueue).not.toHaveBeenCalled();
  });

  it('works unchanged where WhatsApp is not wired', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new NotificationService(repo, { sendToCustomer: jest.fn() } as unknown as PushService);
    await expect(service.notify(NotificationEvent.ORDER_CONFIRMED, '', vars, 'c1')).resolves.toBeDefined();
  });
});
