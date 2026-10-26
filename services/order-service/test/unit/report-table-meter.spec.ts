import { MeterService } from '../../src/application/services/meter.service';
import { OrderConfigService } from '../../src/config/order-config.service';
import { MeterReading } from '../../src/domain/meter-reading';
import { OrderStatus } from '../../src/domain/order-status';
import { MeterReadingPrismaRepository } from '../../src/infrastructure/prisma/meter-reading.prisma.repository';

const day = (d: string) => new Date(`${d}T00:00:00+07:00`);
const window = { from: day('2026-08-02'), to: day('2026-08-05') };

function reading(over: Partial<MeterReading>): MeterReading {
  return {
    depotId: 'd1',
    date: '2026-08-02',
    openingM3: 1000,
    closingM3: null,
    sourceOpeningM3: null,
    sourceClosingM3: null,
    openingTankPct: null,
    closingTankPct: null,
    openedBy: 'staff',
    openedAt: new Date(),
    closedBy: null,
    closedAt: null,
    alertedAt: null,
    note: null,
    updatedAt: new Date(),
    ...over,
  };
}

const ROWS = [
  reading({ closingM3: 1002.5, sourceOpeningM3: 1000, sourceClosingM3: 1003 }),
  reading({ date: '2026-08-03', openingM3: 1002.5, closingM3: 1004 }),
  reading({ depotId: 'd2' }),
];

function build(directory?: unknown) {
  const repo = {
    depotIdsWithReadings: jest.fn(async (from: string, to: string, limit: number) =>
      [...new Set(ROWS.filter((r) => r.date >= from && r.date <= to).map((r) => r.depotId))]
        .sort()
        .slice(0, limit),
    ),
    listForRange: jest.fn(async (depotId: string, from: string, to: string) =>
      ROWS.filter((r) => r.depotId === depotId && r.date >= from && r.date <= to),
    ),
  };
  // One day's sales for every depot: 120 x 19 L + 10 x 15 L = 2430 L, on 2026-08-02 only.
  const orders = {
    ordersForDepot: jest.fn(async () => [
      {
        status: OrderStatus.DELIVERED,
        createdAt: new Date('2026-08-02T08:00:00.000Z'),
        total: 2600000,
        items: [
          { quantity: 120, volumeMl: 19000, isGallon: true },
          { quantity: 10, volumeMl: 15000, isGallon: true },
        ],
      },
    ]),
  };
  const config = {
    meterReferenceVolumeMl: () => 19000,
    meterVarianceToleranceLiters: () => 200,
    meterTankCapacityLiters: () => 0,
    alertPhone: '',
    businessTimeZone: 'Asia/Jakarta',
  } as unknown as OrderConfigService;
  const service = new MeterService(
    repo as never,
    orders as never,
    { notify: jest.fn() } as never,
    config,
    directory as never,
  );
  return { service, repo };
}

describe('MeterService.reportTable', () => {
  it('sums the same per-day reconciliation the meter screen draws, one row per depot', async () => {
    const { service } = build({
      listContacts: async () => [{ id: 'd1', name: 'Depot Satu', contactPhone: null }],
    });

    const t = await service.reportTable(window);

    expect(t.columns.map((c) => c.type)).toEqual([
      'text',
      'int',
      'date',
      'date',
      'int',
      'int',
      'int',
      'percent',
    ]);
    expect(t.rows.every((r) => r.length === t.columns.length)).toBe(true);
    const d1 = t.rows.find((r) => r[0] === 'Depot Satu')!;
    // 2 reading days; 2500 + 1500 L through the meter; 2430 L sold; variance 70 + 1500;
    // RO recovery 83.3% on the one day the source meter was read.
    expect(d1).toEqual([
      'Depot Satu',
      2,
      '2026-08-01T17:00:00.000Z',
      '2026-08-02T17:00:00.000Z',
      4000,
      2430,
      1570,
      83.3,
    ]);
    // d2 opened but never closed: meter and variance unknown (null), not zero; id as the name.
    expect(t.rows.find((r) => r[0] === 'd2')).toEqual([
      'd2',
      1,
      '2026-08-01T17:00:00.000Z',
      '2026-08-01T17:00:00.000Z',
      null,
      2430,
      null,
      null,
    ]);
    expect(t.truncated).toBe(false);
  });

  it('works without a depot directory and with an open-ended window', async () => {
    const { service } = build();
    const t = await service.reportTable({});
    expect(t.rows.map((r) => r[0])).toEqual(['d1', 'd2']);
  });

  it('returns an empty table for an inverted window and flags a cut-off one', async () => {
    const { service, repo } = build();
    const none = await service.reportTable({ from: day('2026-08-05'), to: day('2026-08-02') });
    expect(none.rows).toEqual([]);
    expect(repo.depotIdsWithReadings).not.toHaveBeenCalled();

    repo.depotIdsWithReadings.mockResolvedValue(Array.from({ length: 5001 }, () => 'd1'));
    const capped = await service.reportTable(window);
    expect(repo.depotIdsWithReadings).toHaveBeenCalledWith('2026-08-02', '2026-08-04', 5001);
    expect(capped.rows).toHaveLength(5000);
    expect(capped.truncated).toBe(true);
  });
});

describe('MeterReadingPrismaRepository.depotIdsWithReadings', () => {
  it('groups distinct depots over the inclusive day range, bounded', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ depotId: 'd1' }, { depotId: 'd2' }]);
    const repo = new MeterReadingPrismaRepository({ meterReading: { groupBy } } as never);

    await expect(repo.depotIdsWithReadings('2026-08-02', '2026-08-04', 11)).resolves.toEqual([
      'd1',
      'd2',
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['depotId'],
      where: {
        readingDate: {
          gte: new Date('2026-08-02T00:00:00.000Z'),
          lte: new Date('2026-08-04T00:00:00.000Z'),
        },
      },
      orderBy: { depotId: 'asc' },
      take: 11,
    });
  });
});
