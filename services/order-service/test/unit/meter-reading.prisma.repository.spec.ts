import { MeterReadingPrismaRepository } from '../../src/infrastructure/prisma/meter-reading.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/** Prisma Decimal stand-in: only .toNumber() is consumed by the mapper. */
const dec = (n: number) => ({ toNumber: () => n });

const DEPOT = 'd1';
const DATE = '2026-08-02';
const readingDate = new Date('2026-08-02T00:00:00.000Z');

function row(over: Record<string, unknown> = {}) {
  return {
    depotId: DEPOT,
    readingDate,
    openingM3: dec(1000),
    closingM3: null,
    sourceOpeningM3: null,
    sourceClosingM3: null,
    openedBy: 'staff-1',
    openedAt: new Date('2026-08-02T01:00:00.000Z'),
    closedBy: null,
    closedAt: null,
    alertedAt: null,
    note: null,
    ...over,
  };
}

describe('MeterReadingPrismaRepository', () => {
  const model = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { meterReading: model } as unknown as PrismaService;
  const repo = new MeterReadingPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('maps a stored row to the domain shape, decimals to numbers', async () => {
    model.findUnique.mockResolvedValue(
      row({ closingM3: dec(1002.6), sourceOpeningM3: dec(500), sourceClosingM3: dec(504) }),
    );
    expect(await repo.findForDate(DEPOT, DATE)).toEqual({
      depotId: DEPOT,
      date: DATE,
      openingM3: 1000,
      closingM3: 1002.6,
      sourceOpeningM3: 500,
      sourceClosingM3: 504,
      openedBy: 'staff-1',
      openedAt: new Date('2026-08-02T01:00:00.000Z'),
      closedBy: null,
      closedAt: null,
      alertedAt: null,
      note: null,
    });
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { depotId_readingDate: { depotId: DEPOT, readingDate } },
    });
  });

  it('returns null when the day was never recorded', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findForDate(DEPOT, DATE)).toBeNull();
  });

  it('creates the day and stamps openedBy on the morning write', async () => {
    model.findUnique.mockResolvedValue(null);
    model.create.mockResolvedValue(row({ openedBy: 'staff-1' }));
    await repo.upsertForDate({ depotId: DEPOT, date: DATE, actorId: 'staff-1', openingM3: 1000 });
    expect(model.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        depotId: DEPOT,
        readingDate,
        openingM3: 1000,
        closingM3: null,
        openedBy: 'staff-1',
        closedBy: null,
        closedAt: null,
      }),
    });
  });

  it('stamps closedBy too when opening and closing arrive together', async () => {
    model.findUnique.mockResolvedValue(null);
    model.create.mockResolvedValue(row({ closingM3: dec(1002) }));
    await repo.upsertForDate({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-1',
      openingM3: 1000,
      closingM3: 1002,
    });
    const data = model.create.mock.calls[0][0].data;
    expect(data.closedBy).toBe('staff-1');
    expect(data.closedAt).toBeInstanceOf(Date);
  });

  it('refuses to invent an opening reading for a closing-only write', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(
      await repo.upsertForDate({ depotId: DEPOT, date: DATE, actorId: 'staff-2', closingM3: 1002 }),
    ).toBeNull();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('patches only the fields supplied, and stamps closedBy on the first closing', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue(row({ closingM3: dec(1002.6), closedBy: 'staff-2' }));
    await repo.upsertForDate({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      closingM3: 1002.6,
      note: 'sore',
    });
    const data = model.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ closingM3: 1002.6, note: 'sore', closedBy: 'staff-2' });
    expect(data.openingM3).toBeUndefined();
    expect(data.closedAt).toBeInstanceOf(Date);
  });

  it('does not rewrite closedBy when an already-closed day is corrected', async () => {
    model.findUnique.mockResolvedValue(row({ closingM3: dec(1002), closedBy: 'staff-2' }));
    model.update.mockResolvedValue(row({ closingM3: dec(1003), closedBy: 'staff-2' }));
    await repo.upsertForDate({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-9',
      closingM3: 1003,
    });
    const data = model.update.mock.calls[0][0].data;
    expect(data.closedBy).toBeUndefined();
    expect(data.closedAt).toBeUndefined();
  });

  it('patches a corrected opening reading without touching the rest', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue(row({ openingM3: dec(1001) }));
    await repo.upsertForDate({ depotId: DEPOT, date: DATE, actorId: 'staff-1', openingM3: 1001 });
    const data = model.update.mock.calls[0][0].data;
    expect(data).toEqual({ openingM3: 1001 });
  });

  it('patches the raw-water pair independently', async () => {
    model.findUnique.mockResolvedValue(row());
    model.update.mockResolvedValue(row({ sourceOpeningM3: dec(500), sourceClosingM3: dec(504) }));
    await repo.upsertForDate({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-1',
      sourceOpeningM3: 500,
      sourceClosingM3: 504,
    });
    expect(model.update.mock.calls[0][0].data).toMatchObject({
      sourceOpeningM3: 500,
      sourceClosingM3: 504,
    });
  });

  it('lists a range inclusively, oldest first', async () => {
    model.findMany.mockResolvedValue([row()]);
    const out = await repo.listForRange(DEPOT, '2026-08-01', '2026-08-02');
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe(DATE);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {
        depotId: DEPOT,
        readingDate: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-02T00:00:00.000Z'),
        },
      },
      orderBy: { readingDate: 'asc' },
    });
  });

  it('stamps alertedAt so the alert fires once per day', async () => {
    model.update.mockResolvedValue(row());
    await repo.markAlerted(DEPOT, DATE);
    expect(model.update.mock.calls[0][0].where).toEqual({
      depotId_readingDate: { depotId: DEPOT, readingDate },
    });
    expect(model.update.mock.calls[0][0].data.alertedAt).toBeInstanceOf(Date);
  });
});
