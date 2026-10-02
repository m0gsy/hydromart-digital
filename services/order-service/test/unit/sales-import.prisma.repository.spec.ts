import {
  SalesImportPrismaRepository,
  isDuplicateExternalRef,
} from '../../src/infrastructure/prisma/sales-import.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const dec = (n: number) => ({ toNumber: () => n });
const DEPOT_A = '11111111-1111-4111-8111-111111111111';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    depotId: DEPOT_A,
    externalRef: 'INV-001',
    occurredAt: new Date('2026-01-05T00:00:00.000Z'),
    customerLabel: null,
    productLabel: 'Galon 19L',
    quantity: 2,
    unitPrice: dec(20000),
    lineTotal: dec(40000),
    paymentMethod: null,
    batchId: 'b1',
    importedBy: 'staff-1',
    importedAt: new Date('2026-01-05T01:00:00.000Z'),
    ...over,
  };
}

describe('SalesImportPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() };
  const prisma = { importedSalesTransaction: model } as unknown as PrismaService;
  const repo = new SalesImportPrismaRepository(prisma);

  afterEach(() => jest.clearAllMocks());

  it('create converts Decimal fields to numbers on the way out', async () => {
    model.create.mockResolvedValue(row());
    const result = await repo.create({
      depotId: DEPOT_A,
      externalRef: 'INV-001',
      occurredAt: new Date('2026-01-05T00:00:00.000Z'),
      customerLabel: null,
      productLabel: 'Galon 19L',
      quantity: 2,
      unitPrice: 20000,
      lineTotal: 40000,
      paymentMethod: null,
      batchId: 'b1',
      importedBy: 'staff-1',
    });
    expect(result).toMatchObject({ unitPrice: 20000, lineTotal: 40000 });
  });

  it('listByDepot filters by depot and the window, newest first', async () => {
    model.findMany.mockResolvedValue([row()]);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');

    const result = await repo.listByDepot(DEPOT_A, { from, to });

    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: DEPOT_A, occurredAt: { gte: from, lt: to } },
      orderBy: { occurredAt: 'desc' },
    });
    expect(result[0]).toMatchObject({ unitPrice: 20000 });
  });

  it('sumByDepot groups by depotId and reads an unbounded window as no filter', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: DEPOT_A, _count: { _all: 3 }, _sum: { lineTotal: dec(90000) } },
    ]);

    const result = await repo.sumByDepot({});

    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['depotId'],
      where: { occurredAt: {} },
      _count: { _all: true },
      _sum: { lineTotal: true },
    });
    expect(result).toEqual([{ depotId: DEPOT_A, orders: 3, revenue: 90000 }]);
  });

  it('sumByDepot answers 0 revenue when a bucket summed to null (no rows matched)', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: DEPOT_A, _count: { _all: 0 }, _sum: { lineTotal: null } },
    ]);
    const result = await repo.sumByDepot({});
    expect(result).toEqual([{ depotId: DEPOT_A, orders: 0, revenue: 0 }]);
  });

  it('sumByProduct groups by productLabel, filtering by a `from`-only window', async () => {
    model.groupBy.mockResolvedValue([
      { productLabel: 'Galon 19L', _count: { _all: 2 }, _sum: { lineTotal: dec(40000) } },
    ]);
    const from = new Date('2026-01-01');
    const result = await repo.sumByProduct({ from });
    expect(model.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { occurredAt: { gte: from } } }),
    );
    expect(result).toEqual([{ productLabel: 'Galon 19L', orders: 2, revenue: 40000 }]);
  });

  it('sumByDepot filters by a `to`-only window', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: DEPOT_A, _count: { _all: 1 }, _sum: { lineTotal: dec(10000) } },
    ]);
    const to = new Date('2026-02-01');
    await repo.sumByDepot({ to });
    expect(model.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { occurredAt: { lt: to } } }),
    );
  });

  it('sumByProduct answers 0 revenue when a bucket summed to null', async () => {
    model.groupBy.mockResolvedValue([
      { productLabel: 'Galon 19L', _count: { _all: 0 }, _sum: { lineTotal: null } },
    ]);
    const result = await repo.sumByProduct({});
    expect(result).toEqual([{ productLabel: 'Galon 19L', orders: 0, revenue: 0 }]);
  });

  it('sumByMethod normalises and folds raw text variants into one bucket', async () => {
    model.groupBy.mockResolvedValue([
      { paymentMethod: 'Tunai', _count: { _all: 2 }, _sum: { lineTotal: dec(40000) } },
      { paymentMethod: 'tunai', _count: { _all: 1 }, _sum: { lineTotal: dec(20000) } },
      { paymentMethod: 'Kartu Kredit', _count: { _all: 1 }, _sum: { lineTotal: dec(5000) } },
    ]);

    const result = await repo.sumByMethod({});

    expect(result).toEqual(
      expect.arrayContaining([
        { method: 'CASH', orders: 3, revenue: 60000 },
        { method: 'OTHER', orders: 1, revenue: 5000 },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('sumByMethod answers 0 revenue when a bucket summed to null', async () => {
    model.groupBy.mockResolvedValue([
      { paymentMethod: null, _count: { _all: 0 }, _sum: { lineTotal: null } },
    ]);
    const result = await repo.sumByMethod({});
    expect(result).toEqual([{ method: 'OTHER', orders: 0, revenue: 0 }]);
  });
});

describe('isDuplicateExternalRef', () => {
  it('recognises a P2002 violation naming externalRef, in an array or a string target', () => {
    expect(isDuplicateExternalRef({ code: 'P2002', meta: { target: ['depotId', 'externalRef'] } })).toBe(true);
    expect(isDuplicateExternalRef({ code: 'P2002', meta: { target: 'depotId_externalRef_key' } })).toBe(true);
  });

  it('rejects anything else: wrong code, no target, or not an error object', () => {
    expect(isDuplicateExternalRef({ code: 'P2002', meta: { target: ['depotId'] } })).toBe(false);
    expect(isDuplicateExternalRef({ code: 'P2025' })).toBe(false);
    expect(isDuplicateExternalRef(new Error('db unreachable'))).toBe(false);
    expect(isDuplicateExternalRef(null)).toBe(false);
    expect(isDuplicateExternalRef('nope')).toBe(false);
    // P2002 with no target at all — the `?? ''` fallback inside the string branch.
    expect(isDuplicateExternalRef({ code: 'P2002', meta: {} })).toBe(false);
  });
});
