import { WaCapPrismaRepository, WaTemplatePrismaRepository } from '../../src/infrastructure/prisma/wa-cap.prisma.repository';
import { WaConsentPrismaRepository } from '../../src/infrastructure/prisma/wa-consent.prisma.repository';
import { WaMessagePrismaRepository } from '../../src/infrastructure/prisma/wa-message.prisma.repository';

// Prisma is mocked: what is pinned here is the SHAPE of each statement (the conditions that make a claim
// single-use, a reservation atomic, a replay a no-op). The real-Postgres races belong to the sender release.
const fn = () => jest.fn();

describe('WaConsentPrismaRepository', () => {
  const waConsent = { createMany: fn(), findMany: fn() };
  const waOptInCode = { create: fn(), findUnique: fn(), updateMany: fn() };
  const waPeerState = { findUnique: fn(), upsert: fn() };
  const repo = new WaConsentPrismaRepository({ waConsent, waOptInCode, waPeerState } as never);
  const now = new Date('2026-11-29T03:00:00.000Z');

  beforeEach(() => jest.resetAllMocks());

  it('append skips a duplicate (source, sourceRef) and says so', async () => {
    waConsent.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const input = { phone: '6281', source: 'KEYWORD', sourceRef: 'wamid.1' } as never;
    await expect(repo.append(input)).resolves.toBe(true);
    await expect(repo.append(input)).resolves.toBe(false);
    expect(waConsent.createMany).toHaveBeenCalledWith({ data: [input], skipDuplicates: true });
  });

  it('reads the ledger oldest first, and the feed after a cursor without the AI web own rows', async () => {
    waConsent.findMany.mockResolvedValue([]);
    await repo.listForPhone('6281');
    await repo.listUtilityForCustomer('c1');
    await repo.listAfter(5n, 500);
    expect(waConsent.findMany.mock.calls).toEqual([
      [{ where: { phone: '6281' }, orderBy: { seq: 'asc' }, take: 1000 }],
      [{ where: { customerId: 'c1', purpose: 'UTILITY', waNumber: '1' }, orderBy: { seq: 'asc' }, take: 1000 }],
      [{ where: { seq: { gt: 5n }, NOT: { source: 'AIWEB' } }, orderBy: { seq: 'asc' }, take: 500 }],
    ]);
  });

  it('creates and finds a code', async () => {
    waOptInCode.create.mockResolvedValue({ id: 'k1' });
    waOptInCode.findUnique.mockResolvedValue({ id: 'k1', code: 'AB23CD45' });
    const data = { code: 'AB23CD45', kind: 'SELF', customerId: 'c1', depotId: null, createdBy: 'c1', expiresAt: now };
    await expect(repo.createCode(data)).resolves.toEqual({ id: 'k1' });
    expect(waOptInCode.create).toHaveBeenCalledWith(expect.objectContaining({ data }));
    await expect(repo.findCode('AB23CD45')).resolves.toEqual({ id: 'k1', code: 'AB23CD45' });
  });

  it('claims a code with ONE conditional update: unused and unexpired', async () => {
    waOptInCode.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    waOptInCode.findUnique.mockResolvedValue({ id: 'k1', usedPhone: '6281' });
    await expect(repo.claimCode('AB23CD45', '6281', now)).resolves.toEqual({ id: 'k1', usedPhone: '6281' });
    await expect(repo.claimCode('AB23CD45', '6282', now)).resolves.toBeNull();
    expect(waOptInCode.updateMany).toHaveBeenCalledWith({
      where: { code: 'AB23CD45', usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, usedPhone: '6281' },
    });
    expect(waOptInCode.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads and stamps the AI web peer', async () => {
    waPeerState.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ lastOkAt: now });
    await expect(repo.peerLastOkAt('AIWEB')).resolves.toBeNull();
    await expect(repo.peerLastOkAt('AIWEB')).resolves.toBe(now);
    await repo.stampPeer('AIWEB', now, 9n);
    expect(waPeerState.upsert).toHaveBeenCalledWith({
      where: { peer: 'AIWEB' },
      create: { peer: 'AIWEB', lastOkAt: now, lastSeq: 9n },
      update: { lastOkAt: now, lastSeq: 9n },
    });
  });
});

describe('WaMessagePrismaRepository', () => {
  const waMessage = { createMany: fn(), findUnique: fn(), update: fn(), updateMany: fn(), findMany: fn(), deleteMany: fn() };
  const waInboundEvent = { createMany: fn(), deleteMany: fn() };
  const repo = new WaMessagePrismaRepository({ waMessage, waInboundEvent } as never);
  const at = new Date('2026-11-29T03:00:00.000Z');

  beforeEach(() => jest.resetAllMocks());

  it('insertIfNew: a second insert of one dedupe key is a no-op', async () => {
    waMessage.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const input = { dedupeKey: 'wa:n1', vars: { name: 'Sari' } } as never;
    await expect(repo.insertIfNew(input)).resolves.toBe(true);
    await expect(repo.insertIfNew(input)).resolves.toBe(false);
    expect(waMessage.createMany).toHaveBeenCalledWith({
      data: [{ dedupeKey: 'wa:n1', vars: { name: 'Sari' } }],
      skipDuplicates: true,
    });
  });

  it('findByDedupeKey reads a null vars column as empty', async () => {
    waMessage.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'm1', vars: null }).mockResolvedValueOnce({ id: 'm2', vars: { a: '1' } });
    await expect(repo.findByDedupeKey('x')).resolves.toBeNull();
    await expect(repo.findByDedupeKey('wa:n1')).resolves.toEqual({ id: 'm1', vars: {} });
    await expect(repo.findByDedupeKey('wa:n2')).resolves.toEqual({ id: 'm2', vars: { a: '1' } });
  });

  it('moves a message to SENT, retries it, or fails it with a bounded error', async () => {
    await repo.markSent('m1', 'wamid.9', at);
    await repo.markRetry('m1');
    await repo.markFailed('m1', '131026', 'x'.repeat(900), at);
    expect(waMessage.update.mock.calls[0][0]).toEqual({
      where: { id: 'm1' },
      data: { status: 'SENT', metaMessageId: 'wamid.9', sentAt: at, attempts: { increment: 1 } },
    });
    expect(waMessage.update.mock.calls[1][0]).toEqual({ where: { id: 'm1' }, data: { attempts: { increment: 1 } } });
    const failed = waMessage.update.mock.calls[2][0].data;
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: '131026', failedAt: at });
    expect(failed.error).toHaveLength(500);
  });

  it('STOP cancels what is still QUEUED for the phone', async () => {
    waMessage.updateMany.mockResolvedValue({ count: 2 });
    await expect(repo.cancelQueuedForPhone('6281')).resolves.toBe(2);
    expect(waMessage.updateMany).toHaveBeenCalledWith({
      where: { phone: '6281', status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
  });

  it('claimQueued claims only unclaimed or stale rows, with the same condition inside the UPDATE', async () => {
    const stale = new Date('2026-11-29T02:55:00.000Z');
    waMessage.findMany.mockResolvedValueOnce([]);
    await expect(repo.claimQueued(10, 'tok', at, stale)).resolves.toEqual([]);
    expect(waMessage.updateMany).not.toHaveBeenCalled();

    waMessage.findMany.mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]).mockResolvedValueOnce([{ id: 'm1', vars: null }]);
    await expect(repo.claimQueued(10, 'tok', at, stale)).resolves.toEqual([{ id: 'm1', vars: {} }]);
    const free = { status: 'QUEUED', OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }] };
    expect(waMessage.findMany.mock.calls[1][0]).toMatchObject({ where: free, take: 10 });
    expect(waMessage.updateMany).toHaveBeenCalledWith({
      where: { ...free, id: { in: ['m1', 'm2'] } },
      data: { claimToken: 'tok', claimedAt: at },
    });
    expect(waMessage.findMany.mock.calls[2][0]).toMatchObject({ where: { claimToken: 'tok', status: 'QUEUED' } });
  });

  it('recordInbound is true once per event key', async () => {
    waInboundEvent.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.recordInbound('wamid.1', 'message')).resolves.toBe(true);
    await expect(repo.recordInbound('wamid.1', 'message')).resolves.toBe(false);
    expect(waInboundEvent.createMany).toHaveBeenCalledWith({
      data: [{ eventKey: 'wamid.1', kind: 'message' }],
      skipDuplicates: true,
    });
  });

  it('purges by age', async () => {
    waMessage.deleteMany.mockResolvedValue({ count: 3 });
    waInboundEvent.deleteMany.mockResolvedValue({ count: 4 });
    await expect(repo.purgeMessagesBefore(at)).resolves.toBe(3);
    await expect(repo.purgeInboundBefore(at)).resolves.toBe(4);
    expect(waMessage.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: at } } });
    expect(waInboundEvent.deleteMany).toHaveBeenCalledWith({ where: { receivedAt: { lt: at } } });
  });
});

describe('WaCapPrismaRepository', () => {
  const waCap = { findUnique: fn(), findMany: fn(), upsert: fn(), updateMany: fn() };
  const waCostCounter = { createMany: fn(), updateMany: fn(), findUniqueOrThrow: fn(), findMany: fn() };
  const repo = new WaCapPrismaRepository({ waCap, waCostCounter } as never);
  const at = new Date('2026-11-29T03:00:00.000Z');
  const capRow = (over: Record<string, unknown> = {}) => ({
    waNumber: '1',
    category: 'UTILITY',
    monthlyMessages: 5,
    rateIdr: null,
    monthlyCostIdr: null,
    paused: false,
    ...over,
  });
  const key = { waNumber: '1', monthKey: '2026-11', category: 'UTILITY' };

  beforeEach(() => jest.resetAllMocks());

  it('reads caps with Decimal columns as numbers, and null as null', async () => {
    waCap.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(capRow({ rateIdr: { toString: () => '412.50' }, monthlyCostIdr: { toString: () => '100000' } }));
    await expect(repo.getCap('1', 'UTILITY')).resolves.toBeNull();
    await expect(repo.getCap('1', 'UTILITY')).resolves.toMatchObject({ rateIdr: 412.5, monthlyCostIdr: 100000 });
    waCap.findMany.mockResolvedValue([capRow()]);
    await expect(repo.listCaps('1')).resolves.toEqual([capRow()]);
  });

  it('upserts a cap and pauses every row of a number', async () => {
    await repo.upsertCap('1', 'UTILITY', { monthlyMessages: 10, rateIdr: null, monthlyCostIdr: null }, 'hq1');
    expect(waCap.upsert).toHaveBeenCalledWith({
      where: { waNumber_category: { waNumber: '1', category: 'UTILITY' } },
      create: { waNumber: '1', category: 'UTILITY', monthlyMessages: 10, rateIdr: null, monthlyCostIdr: null, updatedBy: 'hq1' },
      update: { monthlyMessages: 10, rateIdr: null, monthlyCostIdr: null, updatedBy: 'hq1' },
    });
    waCap.updateMany.mockResolvedValue({ count: 4 });
    await expect(repo.setPausedAll('1', true, 'hq1')).resolves.toBe(4);
    expect(waCap.updateMany).toHaveBeenCalledWith({ where: { waNumber: '1' }, data: { paused: true, updatedBy: 'hq1' } });
  });

  describe('reserve', () => {
    it('no cap row = CAP and nothing is counted; a paused row = PAUSED', async () => {
      waCap.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(capRow({ paused: true }));
      await expect(repo.reserve('1', '2026-11', 'UTILITY')).resolves.toEqual({ ok: false, reason: 'CAP' });
      await expect(repo.reserve('1', '2026-11', 'UTILITY')).resolves.toEqual({ ok: false, reason: 'PAUSED' });
      expect(waCostCounter.createMany).not.toHaveBeenCalled();
    });

    it('counts one message with a single conditional UPDATE (messages < cap) and reports the crossings', async () => {
      waCap.findUnique.mockResolvedValue(capRow());
      waCostCounter.updateMany.mockResolvedValue({ count: 1 });
      waCostCounter.findUniqueOrThrow.mockResolvedValue({ messages: 4, costIdr: { toString: () => '0' } });
      await expect(repo.reserve('1', '2026-11', 'UTILITY')).resolves.toEqual({ ok: true, messages: 4, costIdr: 0, warn: true, reachesCap: false });
      expect(waCostCounter.createMany).toHaveBeenCalledWith({ data: [key], skipDuplicates: true });
      expect(waCostCounter.updateMany).toHaveBeenCalledWith({
        where: { ...key, messages: { lt: 5 } },
        data: { messages: { increment: 1 }, costIdr: { increment: 0 } },
      });
      waCostCounter.findUniqueOrThrow.mockResolvedValue({ messages: 5, costIdr: { toString: () => '0' } });
      await expect(repo.reserve('1', '2026-11', 'UTILITY')).resolves.toMatchObject({ reachesCap: true });
      waCostCounter.findUniqueOrThrow.mockResolvedValue({ messages: 1, costIdr: { toString: () => '0' } });
      await expect(repo.reserve('1', '2026-11', 'UTILITY')).resolves.toMatchObject({ warn: false });
    });

    it('a lost race (no row updated) is CAP', async () => {
      waCap.findUnique.mockResolvedValue(capRow());
      waCostCounter.updateMany.mockResolvedValue({ count: 0 });
      await expect(repo.reserve('1', '2026-11', 'UTILITY')).resolves.toEqual({ ok: false, reason: 'CAP' });
      expect(waCostCounter.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('adds the cost guard only when a rate AND a cost cap are set; SERVICE costs 0', async () => {
      waCostCounter.updateMany.mockResolvedValue({ count: 0 });
      waCap.findUnique.mockResolvedValue(capRow({ rateIdr: { toString: () => '400' }, monthlyCostIdr: { toString: () => '1000' } }));
      await repo.reserve('1', '2026-11', 'UTILITY');
      expect(waCostCounter.updateMany).toHaveBeenLastCalledWith({
        where: { ...key, messages: { lt: 5 }, costIdr: { lte: 600 } },
        data: { messages: { increment: 1 }, costIdr: { increment: 400 } },
      });
      waCap.findUnique.mockResolvedValue(capRow({ category: 'SERVICE', rateIdr: { toString: () => '400' }, monthlyCostIdr: { toString: () => '1000' } }));
      await repo.reserve('1', '2026-11', 'SERVICE');
      expect(waCostCounter.updateMany).toHaveBeenLastCalledWith({
        where: { ...key, category: 'SERVICE', messages: { lt: 5 }, costIdr: { lte: 1000 } },
        data: { messages: { increment: 1 }, costIdr: { increment: 0 } },
      });
      // cost cap without a rate on the row: nothing to add up, no cost guard
      waCap.findUnique.mockResolvedValue(capRow({ monthlyCostIdr: { toString: () => '1000' } }));
      await repo.reserve('1', '2026-11', 'UTILITY');
      expect(waCostCounter.updateMany).toHaveBeenLastCalledWith({
        where: { ...key, messages: { lt: 5 } },
        data: { messages: { increment: 1 }, costIdr: { increment: 0 } },
      });
    });
  });

  describe('release', () => {
    it('gives one message and its cost back, never below zero', async () => {
      waCap.findUnique.mockResolvedValue(capRow({ rateIdr: { toString: () => '400' } }));
      await repo.release('1', '2026-11', 'UTILITY');
      expect(waCostCounter.updateMany).toHaveBeenCalledWith({
        where: { ...key, messages: { gt: 0 }, costIdr: { gte: 400 } },
        data: { messages: { decrement: 1 }, costIdr: { decrement: 400 } },
      });
    });

    it('with no cap row or no rate it gives back the message only', async () => {
      waCap.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(capRow());
      await repo.release('1', '2026-11', 'UTILITY');
      await repo.release('1', '2026-11', 'UTILITY');
      for (const call of waCostCounter.updateMany.mock.calls) {
        expect(call[0]).toEqual({
          where: { ...key, messages: { gt: 0 }, costIdr: { gte: 0 } },
          data: { messages: { decrement: 1 }, costIdr: { decrement: 0 } },
        });
      }
    });
  });

  it('warned and stopped are set once: only the caller whose UPDATE changed a row gets true', async () => {
    waCostCounter.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.markWarned('1', '2026-11', 'UTILITY', at)).resolves.toBe(true);
    await expect(repo.markWarned('1', '2026-11', 'UTILITY', at)).resolves.toBe(false);
    expect(waCostCounter.updateMany).toHaveBeenCalledWith({ where: { ...key, warnedAt: null }, data: { warnedAt: at } });
    waCostCounter.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(repo.markStopped('1', '2026-11', 'UTILITY', at)).resolves.toBe(true);
    expect(waCostCounter.updateMany).toHaveBeenLastCalledWith({ where: { ...key, stoppedAt: null }, data: { stoppedAt: at } });
  });

  it('lists the month counters with cost as a number', async () => {
    waCostCounter.findMany.mockResolvedValue([{ ...key, messages: 2, costIdr: { toString: () => '800.5' }, warnedAt: null, stoppedAt: null }]);
    await expect(repo.listCounters('2026-11')).resolves.toEqual([{ ...key, messages: 2, costIdr: 800.5, warnedAt: null, stoppedAt: null }]);
  });
});

describe('WaTemplatePrismaRepository', () => {
  const waTemplate = { findMany: fn(), createMany: fn(), updateMany: fn() };
  const repo = new WaTemplatePrismaRepository({ waTemplate } as never);

  beforeEach(() => jest.resetAllMocks());

  it('lists, registers a DRAFT without touching an existing row, and sets a status', async () => {
    waTemplate.findMany.mockResolvedValue([{ name: 'hm_order_confirmed' }]);
    await expect(repo.list()).resolves.toEqual([{ name: 'hm_order_confirmed' }]);
    const template = { name: 'hm_order_confirmed', language: 'id', event: 'ORDER_CONFIRMED', category: 'UTILITY', bodyParams: 2 };
    await repo.ensure(template);
    expect(waTemplate.createMany).toHaveBeenCalledWith({ data: [template], skipDuplicates: true });
    waTemplate.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.setStatus('hm_order_confirmed', 'id', 'APPROVED', null)).resolves.toBe(true);
    await expect(repo.setStatus('nope', 'id', 'APPROVED', null)).resolves.toBe(false);
    expect(waTemplate.updateMany).toHaveBeenCalledWith({
      where: { name: 'hm_order_confirmed', language: 'id' },
      data: { status: 'APPROVED', statusReason: null },
    });
  });
});
