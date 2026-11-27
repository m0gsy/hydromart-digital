import { Prisma } from '../../prisma/generated/client';
import { B2bProspectPrismaRepository } from '../../src/infrastructure/prisma/b2b-prospect.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { prospect } from '../support/b2b-fakes';

// Asserts the EXACT prisma calls and the row mapping against a mock; the locking and the unique
// indexes themselves are proven on real Postgres by test/race/b2b-prospect.race.ts (CI).

describe('B2bProspectPrismaRepository', () => {
  const p = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
  };
  const dnc = { count: jest.fn(), createMany: jest.fn() };
  const batch = { create: jest.fn(), aggregate: jest.fn() };
  const visit = { findMany: jest.fn(), updateMany: jest.fn() };
  const tx = { b2bProspect: p, b2bDoNotContact: dnc, b2bProspectVisit: visit, $executeRaw: jest.fn() };
  const prisma = {
    ...tx,
    b2bImportBatch: batch,
    b2bProspectVisit: visit,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const repo = new B2bProspectPrismaRepository(prisma);
  const row = prospect();

  beforeEach(() => {
    jest.clearAllMocks();
    dnc.count.mockResolvedValue(0);
    p.findMany.mockResolvedValue([]);
  });

  describe('list', () => {
    it('scopes the work list to the depots, newest first, one row extra for the cursor', async () => {
      p.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      const out = await repo.list({ scope: 'work', depotIds: ['d1'], limit: 2, cursor: 'a', status: 'NEW', category: 'KOS', kecamatanCode: 'K', kelurahanCode: 'L', assignedToId: 'u', q: 'kos' });
      expect(out).toEqual({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c' });
      expect(p.findMany).toHaveBeenCalledWith({
        where: {
          ownerDepotId: { in: ['d1'] },
          status: 'NEW',
          category: 'KOS',
          kecamatanCode: 'K',
          kelurahanCode: 'L',
          assignedToId: 'u',
          name: { contains: 'kos', mode: 'insensitive' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        cursor: { id: 'a' },
      });
    });

    it('reads a network work list as "has an owner", the map as "has none", and unassigned as null', async () => {
      await repo.list({ scope: 'work', limit: 5, unassigned: true });
      expect(p.findMany).toHaveBeenLastCalledWith({
        where: { ownerDepotId: { not: null }, assignedToId: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 6,
      });
      expect(await repo.list({ scope: 'map', limit: 5 })).toEqual({ items: [], nextCursor: null });
      expect(p.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ownerDepotId: null } }));
    });
  });

  it('finds one by id and reads the latest visits', async () => {
    p.findUnique.mockResolvedValue(row);
    expect(await repo.findById('x')).toBe(row);
    expect(p.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
    visit.findMany.mockResolvedValue([{ id: 'v' }]);
    expect(await repo.visits('x', 20)).toEqual([{ id: 'v' }]);
    expect(visit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { prospectId: 'x' }, orderBy: { visitedAt: 'desc' }, take: 20 }));
  });

  describe('duplicate candidates and do-not-contact', () => {
    const probe = { source: 'OSM', sourceId: 'node/1', phoneE164: '+6281', nameKey: 'k', latitude: -6.2, longitude: 106.8 } as const;

    it('searches by dataset id, phone, and a same-name box around the pin', async () => {
      p.findMany.mockResolvedValue([{ nameKey: 'k' }]);
      expect(await repo.findDuplicateCandidates(probe)).toEqual([{ nameKey: 'k' }]);
      const where = p.findMany.mock.calls[0]![0].where.OR as Record<string, unknown>[];
      expect(where).toHaveLength(3);
      expect(where[0]).toEqual({ source: 'OSM', sourceId: 'node/1' });
      expect(where[1]).toEqual({ phoneE164: '+6281' });
      expect(where[2]).toMatchObject({ nameKey: 'k', latitude: { gte: expect.closeTo(-6.202, 6), lte: expect.closeTo(-6.198, 6) } });
    });

    it('drops the id and phone legs when the probe has none', async () => {
      await repo.findDuplicateCandidates({ ...probe, sourceId: null, phoneE164: null });
      expect(p.findMany.mock.calls[0]![0].where.OR).toHaveLength(1);
    });

    it('answers whether a phone or any place key is on the list', async () => {
      dnc.count.mockResolvedValue(1);
      expect(await repo.dncPresent({ phoneHash: 'h', placeHashes: ['a', 'b'] })).toBe(true);
      expect(dnc.count).toHaveBeenCalledWith({
        where: { OR: [{ kind: 'PHONE', keyHash: 'h' }, { kind: 'PLACE', keyHash: { in: ['a', 'b'] } }] },
      });
      expect(await repo.dncPresent({ phoneHash: null, placeHashes: [] })).toBe(false);
      expect(dnc.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('createGuarded', () => {
    const data = {
      name: 'Kos', nameKey: 'kos', category: 'KOS', phoneE164: null, contactName: null, address: null, latitude: -6.2,
      longitude: 106.8, gridCell: '1:1', kecamatanCode: null, kelurahanCode: null, ownerDepotId: null, source: 'OSM',
      licence: 'ODbL-1.0', sourceId: null, sourceDataset: null, sourceDate: null, batchId: null, note: null, createdById: null,
    } as const;
    const keys = { phoneHash: null, placeHashes: ['x'] };

    it('takes the write lock, re-checks, then inserts with the retention clock set', async () => {
      p.create.mockResolvedValue(row);
      expect(await repo.createGuarded(data as never, keys)).toEqual({ ok: true, prospect: row });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 20_000 });
      expect(p.create).toHaveBeenCalledWith({ data: { ...data, lastActivityAt: expect.any(Date) } });
    });

    it('refuses under the lock when a do-not-contact entry or a duplicate appeared meanwhile', async () => {
      dnc.count.mockResolvedValue(1);
      expect(await repo.createGuarded(data as never, keys)).toEqual({ ok: false, reason: 'DO_NOT_CONTACT' });
      dnc.count.mockResolvedValue(0);
      p.findMany.mockResolvedValue([{ ...data, nameKey: 'kos' }]);
      expect(await repo.createGuarded(data as never, keys)).toEqual({ ok: false, reason: 'DUPLICATE' });
      expect(p.create).not.toHaveBeenCalled();
    });

    it('turns a unique violation into a duplicate and lets any other error through', async () => {
      p.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }));
      expect(await repo.createGuarded(data as never, keys)).toEqual({ ok: false, reason: 'DUPLICATE' });
      p.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2003', clientVersion: '5.22.0' }));
      await expect(repo.createGuarded(data as never, keys)).rejects.toThrow('x');
      p.create.mockRejectedValueOnce(new Error('boom'));
      await expect(repo.createGuarded(data as never, keys)).rejects.toThrow('boom');
    });
  });

  describe('update', () => {
    it('writes only onto the version the caller read, and says null when it lost', async () => {
      const seen = new Date('2026-11-27T00:00:00Z');
      p.updateMany.mockResolvedValueOnce({ count: 1 });
      p.findUnique.mockResolvedValue(row);
      expect(await repo.update('x', { status: 'LOST', lastActivityAt: seen }, seen)).toBe(row);
      expect(p.updateMany).toHaveBeenCalledWith({ where: { id: 'x', updatedAt: seen }, data: { status: 'LOST', lastActivityAt: seen } });
      p.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await repo.update('x', { lastActivityAt: seen }, seen)).toBeNull();
      p.updateMany.mockResolvedValueOnce({ count: 1 });
      await repo.update('x', { lastActivityAt: seen });
      expect(p.updateMany).toHaveBeenLastCalledWith({ where: { id: 'x' }, data: { lastActivityAt: seen } });
    });
  });

  describe('do-not-contact writes', () => {
    const entries = [{ kind: 'PHONE' as const, keyHash: 'h' }];

    it('adds entries idempotently', async () => {
      await repo.addDnc(entries, 'LEGAL', 'u1');
      expect(dnc.createMany).toHaveBeenCalledWith({ data: [{ kind: 'PHONE', keyHash: 'h', reason: 'LEGAL', addedById: 'u1' }], skipDuplicates: true });
    });

    it('suppresses in one transaction under the write lock: entries, then every live match wiped of anything identifying', async () => {
      p.findMany.mockResolvedValue([{ id: 'x', ownerDepotId: 'd1' }, { id: 'y', ownerDepotId: null }]);
      const out = await repo.suppress({ id: 'x', phoneE164: '+62', nameKey: 'k', cells: ['1:1'] }, entries, 'OTHER', 'u1');
      expect(out).toEqual([{ id: 'x', ownerDepotId: 'd1' }, { id: 'y', ownerDepotId: null }]);
      expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 20_000 });
      // the lock is the FIRST statement, before the entries
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(dnc.createMany.mock.invocationCallOrder[0]!);
      expect(dnc.createMany).toHaveBeenCalledTimes(1);
      expect(p.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ id: 'x' }, { phoneE164: '+62' }, { nameKey: 'k', gridCell: { in: ['1:1'] } }],
          status: { notIn: ['CONVERTED', 'DO_NOT_CONTACT'] },
        },
        select: { id: true, ownerDepotId: true },
      });
      const arg = p.updateMany.mock.calls[0]![0];
      expect(arg.where).toEqual({ id: { in: ['x', 'y'] } });
      expect(arg.data).toEqual({
        status: 'DO_NOT_CONTACT', name: '(dihapus: jangan hubungi)', nameKey: '', latitude: 0, longitude: 0, sourceId: null,
        sourceDataset: null, phoneE164: null, contactName: null, note: null, address: null, lostReason: null,
        assignedToId: null, assignedAt: null,
      });
      // kept: category, cell, codes, source, owner depot; and the retention clock is not touched
      for (const kept of ['category', 'gridCell', 'kecamatanCode', 'source', 'ownerDepotId', 'lastActivityAt']) {
        expect(arg.data).not.toHaveProperty(kept);
      }
      expect(visit.updateMany).toHaveBeenCalledWith({ where: { prospectId: { in: ['x', 'y'] } }, data: { latitude: 0, longitude: 0, note: null } });
    });

    it('writes only the entries when nothing can match or nothing live matched', async () => {
      expect(await repo.suppress({ nameKey: 'k' }, entries, 'OTHER', 'u1')).toEqual([]);
      expect(p.findMany).not.toHaveBeenCalled();
      p.findMany.mockResolvedValue([]);
      expect(await repo.suppress({ id: 'x' }, entries, 'OTHER', 'u1')).toEqual([]);
      expect(p.updateMany).not.toHaveBeenCalled();
      expect(dnc.createMany).toHaveBeenCalledTimes(2);
    });
  });

  it('logs an import batch', async () => {
    const data = { id: 'b', sources: 'osm', licences: 'ODbL-1.0', rows: 1, created: 1, refused: 0, failed: 0, costIdr: 0, importedById: 'u' };
    await repo.createBatch(data);
    expect(batch.create).toHaveBeenCalledWith({ data });
  });

  describe('coverage', () => {
    const setup = (age: unknown) => {
      p.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      p.groupBy
        .mockResolvedValueOnce([{ category: 'KOS', _count: { _all: 4 } }, { category: 'KLINIK', _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ category: 'KOS', _count: { _all: 3 } }])
        .mockResolvedValueOnce([{ status: 'NEW', _count: { _all: 5 } }])
        .mockResolvedValueOnce([{ source: 'OSM', _count: { _all: 5 } }]);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([age]);
    };

    it('aggregates in SQL for the network, with the cost and the data age', async () => {
      setup({ newest: new Date('2026-11-26T00:00:00Z'), oldest: new Date('2026-11-01T00:00:00Z'), median: 1_700_000_000_000 });
      batch.aggregate.mockResolvedValue({ _sum: { costIdr: 7 } });
      const out = await repo.coverage({ includeCost: true });
      expect(out).toEqual({
        total: 5,
        onMap: 2,
        byCategory: [{ category: 'KOS', total: 4, withPhone: 3 }, { category: 'KLINIK', total: 1, withPhone: 0 }],
        byStatus: [{ status: 'NEW', total: 5 }],
        bySource: [{ source: 'OSM', total: 5 }],
        age: { newest: Date.parse('2026-11-26T00:00:00Z'), median: 1_700_000_000_000, oldest: Date.parse('2026-11-01T00:00:00Z') },
        thirdPartyCostIdr: 7,
      });
      expect(p.count).toHaveBeenNthCalledWith(1, { where: {} });
      expect(p.count).toHaveBeenNthCalledWith(2, { where: { ownerDepotId: null } });
    });

    it('scopes to the depots, has no map bucket or cost, and reads an empty table as no age', async () => {
      p.count.mockResolvedValueOnce(0);
      p.groupBy.mockResolvedValue([]);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ newest: null, oldest: null, median: null }]);
      const out = await repo.coverage({ depotIds: ['d1'], includeCost: false });
      expect(out).toMatchObject({ total: 0, onMap: 0, age: null, thirdPartyCostIdr: null, byCategory: [] });
      expect(p.count).toHaveBeenCalledWith({ where: { ownerDepotId: { in: ['d1'] } } });
      expect(batch.aggregate).not.toHaveBeenCalled();
    });

    it('counts an empty batch table as zero cost', async () => {
      setup(undefined);
      batch.aggregate.mockResolvedValue({ _sum: { costIdr: null } });
      expect(await repo.coverage({ includeCost: true })).toMatchObject({ thirdPartyCostIdr: 0, age: null });
    });
  });
});
