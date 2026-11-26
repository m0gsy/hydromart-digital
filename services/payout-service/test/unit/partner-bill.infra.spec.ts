import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { PartnerBillController, PartnerBillExternalController } from '../../src/modules/partner-bill.controller';
import { PartnerBillPrismaRepository } from '../../src/infrastructure/prisma/partner-bill.prisma.repository';
import { LedgerPrismaRepository } from '../../src/infrastructure/prisma/ledger.prisma.repository';
import { PartnerBillSourcesHttpAdapter } from '../../src/infrastructure/http/partner-bill-sources.http.adapter';
import { PartnerBillNotifierHttpAdapter } from '../../src/infrastructure/http/partner-bill-notifier.http.adapter';
import { PayoutAuditSink } from '../../src/infrastructure/http/audit.sink';
import { GenerateBillsDto, PartnerBillListQueryDto, VoidBillDto } from '../../src/modules/dto/partner-bill.dto';

const NOW = new Date('2026-11-08T03:00:00Z');
const BILL_ROW = {
  id: 'b1',
  legalEntityId: 'e1',
  legalEntityName: 'PT A',
  month: '2026-10',
  status: 'SENT',
  totalIdr: '150000',
  createdAt: NOW,
  approvedBy: 'f1',
  approvedAt: NOW,
  sentAt: NOW,
  voidReason: null,
  bankName: 'BCA',
  bankAccountNumber: '123456',
  bankAccountHolder: 'PT Indowater',
  recipientIds: ['o1', 'o2'],
  lines: [{ id: 'l1', depotId: 'd1', label: 'Royalti', amountIdr: '150000', basis: { from: 'a', to: 'b' } }],
};

describe('PartnerBill controllers', () => {
  const rec = { ...BILL_ROW, recipientIds: ['o1', 'o2'] };
  const service = {
    list: jest.fn().mockResolvedValue([rec]),
    forOwner: jest.fn().mockResolvedValue([rec]),
    get: jest.fn().mockResolvedValue(rec),
    generate: jest.fn().mockResolvedValue({ month: '2026-10', made: 1 }),
    approve: jest.fn().mockResolvedValue(rec),
    void: jest.fn().mockResolvedValue(rec),
  };
  const ctl = new PartnerBillController(service as never);
  const user = { sub: 'u1' } as never;

  it('shows owners as a count, never as ids, on every read and write', async () => {
    for (const out of [
      (await ctl.list({}))[0],
      (await ctl.mine(user))[0],
      await ctl.get('b1'),
      await ctl.approve('b1', user),
      await ctl.void('b1', { reason: 'salah' }, user),
    ]) {
      expect(out).toMatchObject({ id: 'b1', recipients: 2 });
      expect(out).not.toHaveProperty('recipientIds');
    }
    expect(service.forOwner).toHaveBeenCalledWith('u1');
    expect(service.void).toHaveBeenCalledWith('b1', 'salah', 'u1');
  });

  it('runs the same generate for Finance and for the machine route', async () => {
    await ctl.generate({ month: '2026-10' });
    await new PartnerBillExternalController(service as never).generate({ month: '2026-10' });
    expect(service.generate).toHaveBeenCalledTimes(2);
  });

  it('validates the month, the void reason and the list filter', async () => {
    const bad = (cls: new () => object, plain: object) => validate(plainToInstance(cls, plain)).then((e) => e.length);
    expect(await bad(GenerateBillsDto, { month: '2026-10' })).toBe(0);
    expect(await bad(GenerateBillsDto, { month: '2026-13' })).toBeGreaterThan(0);
    expect(await bad(VoidBillDto, { reason: '  ab ' })).toBeGreaterThan(0);
    expect(await bad(VoidBillDto, { reason: 5 })).toBeGreaterThan(0);
    expect(await bad(VoidBillDto, { reason: ' salah badan hukum ' })).toBe(0);
    expect(await bad(PartnerBillListQueryDto, { status: 'DRAFT', month: '2026-10' })).toBe(0);
    expect(await bad(PartnerBillListQueryDto, { status: 'PAID' })).toBeGreaterThan(0);
  });
});

describe('PartnerBillPrismaRepository', () => {
  const setup = () => {
    const prisma = {
      partnerBill: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    return { prisma, repo: new PartnerBillPrismaRepository(prisma as never) };
  };

  it('reads a row into a record: whole rupiah, the bank only when complete, lines when included', async () => {
    const { prisma, repo } = setup();
    prisma.partnerBill.findUnique.mockResolvedValueOnce(BILL_ROW);
    expect(await repo.findById('b1')).toMatchObject({
      totalIdr: 150000,
      bank: { bankName: 'BCA' },
      recipientIds: ['o1', 'o2'],
      lines: [{ amountIdr: 150000, label: 'Royalti' }],
    });
    prisma.partnerBill.findFirst.mockResolvedValueOnce({ ...BILL_ROW, bankName: null, recipientIds: null, lines: undefined });
    const live = await repo.findLive('e1', '2026-10');
    expect(live?.bank).toBeNull();
    expect(live?.recipientIds).toEqual([]);
    expect(live).not.toHaveProperty('lines');
    prisma.partnerBill.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findLive('e1', '2026-09')).toBeNull();
    prisma.partnerBill.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('turns the live-bill unique index into null and rethrows the rest', async () => {
    const { prisma, repo } = setup();
    const data = { legalEntityId: 'e1', legalEntityName: 'PT A', month: '2026-10', totalIdr: 1, lines: [] };
    prisma.partnerBill.create.mockResolvedValueOnce(BILL_ROW);
    expect(await repo.create(data)).toMatchObject({ id: 'b1' });
    prisma.partnerBill.create.mockRejectedValueOnce(Object.assign(new Error('u'), { code: 'P2002' }));
    expect(await repo.create(data)).toBeNull();
    const boom = new Error('down');
    prisma.partnerBill.create.mockRejectedValueOnce(boom);
    await expect(repo.create(data)).rejects.toBe(boom);
  });

  it('lists with a filter, and an owner’s bills by recipient', async () => {
    const { prisma, repo } = setup();
    prisma.partnerBill.findMany.mockResolvedValue([BILL_ROW]);
    expect(await repo.list({ month: '2026-10' }, 50)).toHaveLength(1);
    expect(prisma.partnerBill.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { month: '2026-10' }, take: 50 }));
    await repo.listForOwner('o1', 10);
    expect(prisma.partnerBill.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { status: { in: ['SENT', 'VOID'] }, recipientIds: { has: 'o1' } } }),
    );
  });

  it('guards sending on DRAFT and voiding on not-VOID inside the write itself', async () => {
    const { prisma, repo } = setup();
    prisma.partnerBill.updateMany.mockResolvedValue({ count: 1 });
    prisma.partnerBill.findUnique.mockResolvedValue(BILL_ROW);
    const bank = { bankName: 'BCA', bankAccountNumber: '1', bankAccountHolder: 'PT' };
    expect(await repo.markSent('b1', { approvedBy: 'f', recipientIds: ['o1'], bank })).toMatchObject({ id: 'b1' });
    expect(prisma.partnerBill.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'b1', status: 'SENDING' } }));
    expect(await repo.beginSend('b1')).toMatchObject({ id: 'b1' });
    expect(prisma.partnerBill.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'b1', status: { in: ['DRAFT', 'SENDING'] } }, data: { status: 'SENDING' } }),
    );
    expect(await repo.markVoid('b1', 'salah')).toMatchObject({ id: 'b1' });
    expect(prisma.partnerBill.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'b1', status: { in: ['DRAFT', 'SENT'] } } }),
    );
    prisma.partnerBill.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.markSent('b1', { approvedBy: 'f', recipientIds: [], bank })).toBeNull();
    expect(await repo.beginSend('b1')).toBeNull();
    expect(await repo.markVoid('b1', 'x')).toBeNull();
  });
});

describe('LedgerPrismaRepository commission basis (HD-23)', () => {
  it('lists the depots with a commission row in a window', async () => {
    const prisma = { ledgerEntry: { groupBy: jest.fn().mockResolvedValue([{ depotId: 'd1' }, { depotId: null }]) } };
    expect(await new LedgerPrismaRepository(prisma as never).depotsWithCommission(NOW, NOW)).toEqual(['d1']);
  });

  it('nets rows per depot, counts reversals apart and keeps each owner once', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { depotId: 'd1', franchiseOwnerId: 'o1', _sum: { amount: -100000 }, _count: { _all: 4 } },
        { depotId: 'd1', franchiseOwnerId: 'o2', _sum: { amount: -50000 }, _count: { _all: 2 } },
        { depotId: 'd2', franchiseOwnerId: 'o3', _sum: { amount: null }, _count: { _all: 1 } },
        { depotId: null, franchiseOwnerId: 'o9', _sum: { amount: -1 }, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { depotId: 'd1', _sum: { amount: 2500 }, _count: { _all: 1 } },
        { depotId: 'd2', _sum: { amount: null }, _count: { _all: 1 } },
        { depotId: 'dX', _sum: { amount: 1 }, _count: { _all: 1 } },
        { depotId: null, _sum: { amount: 1 }, _count: { _all: 1 } },
      ]);
    const repo = new LedgerPrismaRepository({ ledgerEntry: { groupBy } } as never);
    const rows = await repo.commissionBasis(['d1', 'd2'], NOW, NOW);
    expect(rows).toEqual([
      { depotId: 'd1', commissionIdr: 150000, rows: 6, reversalRows: 1, reversalIdr: 2500, ownerIds: ['o1', 'o2'] },
      { depotId: 'd2', commissionIdr: 0, rows: 1, reversalRows: 1, reversalIdr: 0, ownerIds: ['o3'] },
    ]);
  });
});

describe('PartnerBillSourcesHttpAdapter', () => {
  const config = { depotServiceUrl: 'http://depot', internalServiceKey: 'k' } as never;
  const fetchMock = jest.fn();
  const reply = (status: number, body?: unknown) => ({ ok: status < 400, status, json: async () => body });
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('reads the timeline in chunks of 100 depots and refuses a malformed answer', async () => {
    const adapter = new PartnerBillSourcesHttpAdapter(config);
    const ids = Array.from({ length: 101 }, (_, i) => `d${i}`);
    fetchMock.mockResolvedValue(reply(200, { spans: [{ depotId: 'd1', legalEntityId: null, from: '2026-10-01' }] }));
    expect(await adapter.entityTimeline(ids, '2026-10-01', '2026-10-31')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['x-internal-key']).toBe('k');
    fetchMock.mockResolvedValue(reply(200, { spans: [{ nope: 1 }] }));
    await expect(adapter.entityTimeline(['d1'], 'a', 'b')).rejects.toMatchObject({ code: 'PARTNER_BILL_SOURCE_UNAVAILABLE' });
    fetchMock.mockResolvedValue(reply(200, {}));
    await expect(adapter.entityTimeline(['d1'], 'a', 'b')).rejects.toMatchObject({ status: 503 });
    fetchMock.mockResolvedValue(reply(200, { spans: [null] }));
    await expect(adapter.entityTimeline(['d1'], 'a', 'b')).rejects.toMatchObject({ status: 503 });
  });

  it('fails closed when depot-service is unset, down or answers an error', async () => {
    await expect(
      new PartnerBillSourcesHttpAdapter({ depotServiceUrl: '', internalServiceKey: 'k' } as never).officialAccount(),
    ).rejects.toMatchObject({ status: 503 });
    const adapter = new PartnerBillSourcesHttpAdapter(config);
    fetchMock.mockResolvedValue(reply(500));
    await expect(adapter.officialAccount()).rejects.toMatchObject({ status: 503 });
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(adapter.entities(['e1'])).rejects.toMatchObject({ status: 503 });
  });

  it('names entities, skipping an unknown or odd one', async () => {
    const adapter = new PartnerBillSourcesHttpAdapter(config);
    fetchMock
      .mockResolvedValueOnce(reply(200, { name: 'PT A', kind: 'FRANCHISEE' }))
      .mockResolvedValueOnce(reply(404))
      .mockResolvedValueOnce(reply(200, { name: 7 }));
    expect(await adapter.entities(['e1', 'e2', 'e3'])).toEqual([{ id: 'e1', name: 'PT A', kind: 'FRANCHISEE' }]);
  });

  it('reads the official account only when all three parts are there', async () => {
    const adapter = new PartnerBillSourcesHttpAdapter(config);
    const bank = { bankName: 'BCA', bankAccountNumber: '1', bankAccountHolder: 'PT' };
    fetchMock.mockResolvedValueOnce(reply(200, { bankAccount: bank }));
    expect(await adapter.officialAccount()).toEqual(bank);
    fetchMock.mockResolvedValueOnce(reply(200, { bankAccount: null }));
    expect(await adapter.officialAccount()).toBeNull();
    fetchMock.mockResolvedValueOnce(reply(404));
    expect(await adapter.officialAccount()).toBeNull();
  });

  it('reads a depot name and code, and fails the run (503) when it cannot', async () => {
    const adapter = new PartnerBillSourcesHttpAdapter(config);
    fetchMock.mockResolvedValueOnce(reply(200, { name: 'Depot Satu', code: 'D-1' }));
    expect(await adapter.depot('d1')).toEqual({ name: 'Depot Satu', code: 'D-1' });
    fetchMock.mockResolvedValueOnce(reply(200, { name: 'Depot Satu' }));
    await expect(adapter.depot('d2')).rejects.toMatchObject({ status: 503 });
    fetchMock.mockResolvedValueOnce(reply(404));
    await expect(adapter.depot('d3')).rejects.toMatchObject({ status: 503 });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(adapter.depot('d4')).rejects.toMatchObject({ status: 503 });
  });

  it('reads the owners a depot had on a day from its ownership records', async () => {
    const adapter = new PartnerBillSourcesHttpAdapter(config);
    fetchMock.mockResolvedValueOnce(reply(200, { owners: [{ ownerId: 'o1' }, { ownerId: 'o2' }, { nope: 1 }] }));
    expect(await adapter.ownersAsOf('d1', '2026-10-31T16:59:59.999Z')).toEqual(['o1', 'o2']);
    expect(fetchMock.mock.calls[0][0]).toContain('/depots/internal/d1/owner?asOf=2026-10-31T16%3A59%3A59.999Z');
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await expect(adapter.ownersAsOf('d1', 'x')).rejects.toMatchObject({ status: 503 });
  });
});

describe('PartnerBillNotifierHttpAdapter', () => {
  const notice = {
    billId: 'b1',
    month: '2026-10',
    monthLabel: 'Oktober 2026',
    legalEntityName: 'PT A',
    totalIdr: 1,
    bank: { bankName: 'BCA', bankAccountNumber: '1', bankAccountHolder: 'PT' },
    recipientIds: ['o1'],
  };
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('posts the notice with the internal key and fails closed otherwise', async () => {
    const adapter = new PartnerBillNotifierHttpAdapter({ crmServiceUrl: 'http://crm', internalServiceKey: 'k' } as never);
    fetchMock.mockResolvedValueOnce({ ok: true });
    await adapter.send(notice);
    expect(fetchMock.mock.calls[0][0]).toBe('http://crm/api/v1/notifications/internal/partner-bill');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ billId: 'b1' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(adapter.send(notice)).rejects.toMatchObject({ status: 503 });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(adapter.send(notice)).rejects.toMatchObject({ status: 503 });
    await expect(
      new PartnerBillNotifierHttpAdapter({ crmServiceUrl: '', internalServiceKey: 'k' } as never).send(notice),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('posts the void notice to its own route', async () => {
    const adapter = new PartnerBillNotifierHttpAdapter({ crmServiceUrl: 'http://crm', internalServiceKey: 'k' } as never);
    fetchMock.mockResolvedValueOnce({ ok: true });
    await adapter.sendVoid({ billId: 'b1', monthLabel: 'Oktober 2026', legalEntityName: 'PT A', reason: 'salah', recipientIds: ['o1'] });
    expect(fetchMock.mock.calls[0][0]).toBe('http://crm/api/v1/notifications/internal/partner-bill-void');
  });
});

describe('PayoutAuditSink', () => {
  it('still tries to write when the environment names no auth service (the ingest refuses, the sink does not crash)', async () => {
    const saved = { ...process.env };
    delete process.env.AUTH_SERVICE_URL;
    delete process.env.INTERNAL_SERVICE_KEY;
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
    await expect(new PayoutAuditSink().record({ action: 'x', actorId: null, target: 'y' } as never)).resolves.toBeUndefined();
    process.env = saved;
  });

  it('writes to the trail under the service name, and throws when the row cannot be stored', async () => {
    process.env.AUTH_SERVICE_URL = 'http://auth';
    process.env.INTERNAL_SERVICE_KEY = 'k';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as never;
    const sink = new PayoutAuditSink();
    await sink.record({ action: 'partner-bills.approve', actorId: 'u1', target: 'x' } as never);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe('payout.partner-bills.approve');
    await sink.recordOrThrow({ action: 'partner-bills.generate', actorId: null, target: 'x' } as never);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(sink.recordOrThrow({ action: 'a', actorId: null, target: 'x' } as never)).rejects.toBeDefined();
  });
});
