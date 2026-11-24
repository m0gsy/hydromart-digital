import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AiStockRepository,
  MovementRow,
  PurchaseOrderRow,
  StockLineRow,
} from '../../src/application/ports/ai-stock.repository';
import { APPROVAL_MATCH_MS, AiStockService } from '../../src/application/services/ai-stock.service';
import { InventoryItemType } from '../../src/domain/inventory';
import { LENT_GALLON_REASON, OPNAME_REVERSAL_REASON } from '../../src/domain/stock-reasons';
import { AI_STOCK_ROW_CAP, AiStockPrismaRepository, PRICE_ORDERS_PER_DEPOT } from '../../src/infrastructure/prisma/ai-stock.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AiStockController } from '../../src/modules/ai-stock.controller';
import { AiStockDepotsQueryDto, AiStockWindowQueryDto } from '../../src/modules/dto/ai-stock.dto';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');

const line = (o: Partial<StockLineRow> = {}): StockLineRow => ({
  depotId: D1,
  itemType: InventoryItemType.GALON,
  quantity: 10,
  reserved: 0,
  minimumStock: 0,
  ...o,
});
const move = (o: Partial<MovementRow> = {}): MovementRow => ({
  id: 'm1',
  itemId: 'i1',
  depotId: D1,
  itemType: InventoryItemType.GALON,
  productId: null,
  delta: -2,
  reason: 'pecah',
  createdAt: new Date('2026-11-10T03:00:00Z'),
  ...o,
});
const po = (o: Partial<PurchaseOrderRow> = {}): PurchaseOrderRow => ({
  depotId: D1,
  status: 'RECEIVED',
  createdAt: new Date('2026-11-01T03:00:00Z'),
  receivedAt: new Date('2026-11-02T03:00:00Z'),
  lines: [{ itemType: InventoryItemType.GALON, label: 'Galon', quantity: 10, unitCostIdr: 20_000 }],
  ...o,
});

function repo(over: Partial<AiStockRepository> = {}): AiStockRepository {
  return {
    stockLines: jest.fn().mockResolvedValue([]),
    lossAdjustments: jest.fn().mockResolvedValue([]),
    opnameMovements: jest.fn().mockResolvedValue([]),
    rejectedOpnames: jest.fn().mockResolvedValue([]),
    receivedPurchaseOrders: jest.fn().mockResolvedValue([]),
    sentPurchaseOrders: jest.fn().mockResolvedValue([]),
    damagedGallons: jest.fn().mockResolvedValue([]),
    ...over,
  };
}

describe('AiStockService.stockPosition (S-01)', () => {
  it('available = quantity - reserved; low only when a minimum is set; out is a fact on its own', async () => {
    const svc = new AiStockService(
      repo({
        stockLines: jest.fn().mockResolvedValue([
          line({ quantity: 10, reserved: 6, minimumStock: 5 }), // available 4 <= 5: low
          line({ quantity: 3, reserved: 3, minimumStock: 0 }), // available 0, no minimum: out, not low
          line({ itemType: InventoryItemType.AIR, quantity: 50, reserved: 0, minimumStock: 10 }),
          line({ depotId: D2, quantity: 2, reserved: 5, minimumStock: 1 }), // available -3: low and out
        ]),
      }),
    );
    const rows = await svc.stockPosition([D1, D2]);
    const d1 = rows.find((r) => r.depotId === D1)!;
    expect(d1).toMatchObject({ lines: 3, lowLines: 1, outLines: 1 });
    expect(d1.byType.find((t) => t.itemType === 'GALON')).toEqual({ itemType: 'GALON', availableUnits: 4, lines: 2 });
    expect(rows.find((r) => r.depotId === D2)).toMatchObject({ lines: 1, lowLines: 1, outLines: 1 });
  });
});

describe('AiStockService.wastage (S-03, decision 25-A)', () => {
  it('values the losses the repository returns at the last purchase price', async () => {
    const r = repo({
      lossAdjustments: jest.fn().mockResolvedValue([move({ delta: -2, reason: 'pecah' }), move({ id: 'm4', delta: -1, reason: null })]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue([po()]),
    });
    const rows = await new AiStockService(r).wastage([D1], FROM, TO);
    expect(rows).toEqual([{ depotId: D1, itemType: 'GALON', units: 3, valueIdr: 60_000, unpricedUnits: 0 }]);
  });

  it('prices each loss at the purchase price of its own date, and says what it could not price', async () => {
    const orders = [
      po({ receivedAt: new Date('2026-11-20T03:00:00Z'), lines: [{ itemType: InventoryItemType.GALON, label: 'g', quantity: 1, unitCostIdr: 30_000 }] }),
      po(), // 20_000 from 2 Nov
    ];
    const r = repo({
      lossAdjustments: jest.fn().mockResolvedValue([
        move({ delta: -1, createdAt: new Date('2026-11-10T03:00:00Z') }), // 20_000
        move({ id: 'm2', delta: -1, createdAt: new Date('2026-11-25T03:00:00Z') }), // 30_000
        move({ id: 'm3', delta: -4, itemType: InventoryItemType.TUTUP }), // no price
      ]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue(orders),
    });
    const rows = await new AiStockService(r).wastage([D1], FROM, TO);
    expect(rows.find((x) => x.itemType === 'GALON')).toMatchObject({ units: 2, valueIdr: 50_000, unpricedUnits: 0 });
    expect(rows.find((x) => x.itemType === 'TUTUP')).toEqual({ depotId: D1, itemType: 'TUTUP', units: 4, valueIdr: null, unpricedUnits: 4 });
  });

  it('adds gallons handed back damaged to the gallon row, each priced at its own date, or opens the row', async () => {
    const damaged = jest.fn().mockResolvedValue([
      { depotId: D1, quantity: 2, createdAt: new Date('2026-11-10T03:00:00Z') }, // 20 000 (PO of 2 Nov)
      { depotId: D1, quantity: 1, createdAt: new Date('2026-11-25T03:00:00Z') }, // 30 000 (PO of 20 Nov)
      { depotId: D1, quantity: 1, createdAt: new Date('2026-11-01T03:00:00Z') }, // before any price
      { depotId: D2, quantity: 2, createdAt: new Date('2026-11-10T03:00:00Z') },
    ]);
    const r = repo({
      lossAdjustments: jest.fn().mockResolvedValue([move({ delta: -1, createdAt: new Date('2026-11-10T03:00:00Z') })]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue([
        po({ receivedAt: new Date('2026-11-20T03:00:00Z'), lines: [{ itemType: InventoryItemType.GALON, label: 'g', quantity: 1, unitCostIdr: 30_000 }] }),
        po(),
      ]),
      damagedGallons: damaged,
    });
    const rows = await new AiStockService(r).wastage([D1, D2], FROM, TO);
    expect(damaged).toHaveBeenCalledTimes(1);
    expect(rows.find((x) => x.depotId === D1)).toMatchObject({ units: 5, valueIdr: 20_000 + 40_000 + 30_000, unpricedUnits: 1 });
    // D2 has no PO of its own: its damaged gallons are real units with no price.
    expect(rows.find((x) => x.depotId === D2)).toEqual({ depotId: D2, itemType: 'GALON', units: 2, valueIdr: null, unpricedUnits: 2 });
    expect(rows).toHaveLength(2);
  });

  it('takes no price from a line at 0 (a free sample), a negative one or one that received nothing; the next older price stands', async () => {
    const line = (unitCostIdr: number, extra: object = {}) => ({ itemType: InventoryItemType.GALON, label: 'g', quantity: 5, unitCostIdr, ...extra });
    const r = repo({
      lossAdjustments: jest.fn().mockResolvedValue([move({ delta: -1 })]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue([
        po({ receivedAt: new Date('2026-11-09T03:00:00Z'), lines: [line(0)] }),
        po({ receivedAt: new Date('2026-11-08T03:00:00Z'), lines: [line(-1)] }),
        po({ receivedAt: new Date('2026-11-07T03:00:00Z'), lines: [line(7_000, { receivedQuantity: 0 })] }),
        po({ receivedAt: new Date('2026-11-02T03:00:00Z'), lines: [line(20_000)] }),
      ]),
    });
    expect(await new AiStockService(r).wastage([D1], FROM, TO)).toEqual([{ depotId: D1, itemType: 'GALON', units: 1, valueIdr: 20_000, unpricedUnits: 0 }]);
  });

  it('a price is dated by the day the order was RECEIVED, not the day it was made, and a loss before it has none', async () => {
    const r = repo({
      lossAdjustments: jest.fn().mockResolvedValue([move({ delta: -1, createdAt: new Date('2026-11-05T03:00:00Z') })]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue([po({ createdAt: new Date('2026-11-01T03:00:00Z'), receivedAt: new Date('2026-11-10T03:00:00Z') })]),
    });
    expect(await new AiStockService(r).wastage([D1], FROM, TO)).toEqual([{ depotId: D1, itemType: 'GALON', units: 1, valueIdr: null, unpricedUnits: 1 }]);
  });

  it('a PRODUK line is priced by its own product', async () => {
    const r = repo({
      lossAdjustments: jest.fn().mockResolvedValue([
        move({ itemType: InventoryItemType.PRODUK, productId: 'p1', delta: -2 }),
        move({ id: 'm2', itemType: InventoryItemType.PRODUK, productId: 'p2', delta: -1 }),
      ]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue([
        po({ lines: [{ itemType: InventoryItemType.PRODUK, productId: 'p1', label: 'x', quantity: 10, receivedQuantity: 4, unitCostIdr: 5_000 }] }),
      ]),
    });
    const rows = await new AiStockService(r).wastage([D1], FROM, TO);
    expect(rows).toEqual([{ depotId: D1, itemType: 'PRODUK', units: 3, valueIdr: 10_000, unpricedUnits: 1 }]);
  });
});

describe('AiStockService.opname (S-02, decision 26-A)', () => {
  it('is counted minus system, signed, at the purchase price, and leaves a count HQ rejected out', async () => {
    const counted = new Date('2026-11-10T03:00:00Z');
    const r = repo({
      opnameMovements: jest.fn().mockResolvedValue([
        move({ id: 'a', itemId: 'i1', delta: -4, createdAt: counted }), // rejected below
        move({ id: 'b', itemId: 'i1', delta: -4, createdAt: new Date('2026-11-20T03:00:00Z') }), // same size, other day: stays
        move({ id: 'c', itemId: 'i2', delta: 3, itemType: InventoryItemType.AIR, createdAt: counted }),
      ]),
      rejectedOpnames: jest.fn().mockResolvedValue([
        { depotId: D1, createdAt: new Date(counted.getTime() + 1500), itemId: 'i1', variance: -4 },
        { depotId: D1, createdAt: counted, itemId: null, variance: null }, // an unbacked-reservation warning: no line, skipped
        { depotId: D1, createdAt: counted, itemId: 'i9', variance: -1 }, // nothing to match
      ]),
      receivedPurchaseOrders: jest.fn().mockResolvedValue([
        po(),
        po({ lines: [{ itemType: InventoryItemType.AIR, label: 'Air', quantity: 100, unitCostIdr: 500 }] }),
      ]),
    });
    const rows = await new AiStockService(r).opname([D1], FROM, TO);
    expect(rows.find((x) => x.itemType === 'GALON')).toEqual({ depotId: D1, itemType: 'GALON', units: -4, valueIdr: -80_000, unpricedUnits: 0 });
    expect(rows.find((x) => x.itemType === 'AIR')).toMatchObject({ units: 3, valueIdr: 1_500 });
    expect(r.rejectedOpnames).toHaveBeenCalledWith([D1], new Date(FROM.getTime() - APPROVAL_MATCH_MS), new Date(TO.getTime() + APPROVAL_MATCH_MS));
  });

  it('does not match a rejection to a count made hours away from it', async () => {
    const counted = new Date('2026-11-10T03:00:00Z');
    const r = repo({
      opnameMovements: jest.fn().mockResolvedValue([move({ itemId: 'i1', delta: -4, createdAt: counted })]),
      rejectedOpnames: jest.fn().mockResolvedValue([{ depotId: D1, createdAt: new Date('2026-11-10T09:00:00Z'), itemId: 'i1', variance: -4 }]),
    });
    expect(await new AiStockService(r).opname([D1], FROM, TO)).toHaveLength(1);
  });
});

describe('AiStockService.openPurchases (S-05)', () => {
  it('counts what is still expected on sent orders, short-closed and fully received lines left out', async () => {
    const r = repo({
      sentPurchaseOrders: jest.fn().mockResolvedValue([
        po({
          status: 'SENT',
          lines: [
            { itemType: InventoryItemType.GALON, label: 'g', quantity: 60, receivedQuantity: 40, unitCostIdr: 1_000 }, // 20 x 1000
            { itemType: InventoryItemType.TUTUP, label: 't', quantity: 10, receivedQuantity: 2, shortfallNote: 'habis', unitCostIdr: 500 }, // closed short
            { itemType: InventoryItemType.SEGEL, label: 's', quantity: 5, receivedQuantity: 5, unitCostIdr: 100 }, // in
          ],
        }),
        po({ status: 'SENT', lines: [{ itemType: InventoryItemType.AIR, label: 'a', quantity: 2, unitCostIdr: 250 }] }), // 500
        po({ status: 'SENT', depotId: D2, lines: [{ itemType: InventoryItemType.AIR, label: 'a', quantity: 1, receivedQuantity: 1, unitCostIdr: 9 }] }), // nothing waits
      ]),
    });
    expect(await new AiStockService(r).openPurchases([D1, D2])).toEqual([{ depotId: D1, orders: 2, valueIdr: 20_500 }]);
    expect(r.sentPurchaseOrders).toHaveBeenCalledWith([D1, D2]);
  });
});

describe('AiStockPrismaRepository', () => {
  const prismaWith = (delegates: Record<string, Record<string, jest.Mock>>) =>
    new AiStockPrismaRepository(delegates as unknown as PrismaService);

  it('reads visible lines only, and refuses past the cap instead of cutting', async () => {
    const findMany = jest.fn().mockResolvedValue([{ depotId: D1, itemType: 'GALON', quantity: 1, reserved: 0, minimumStock: 0 }]);
    const r = prismaWith({ inventoryItem: { findMany } });
    expect(await r.stockLines([D1])).toHaveLength(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ depotId: { in: [D1] }, hidden: false });
    findMany.mockResolvedValue(new Array(AI_STOCK_ROW_CAP + 1).fill({}));
    await expect(r.stockLines([D1])).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('reads losses and counts of the window by their own type and maps the line they belong to', async () => {
    const row = { id: 'm', itemId: 'i', delta: -1, reason: null, createdAt: TO, item: { depotId: D1, itemType: 'PRODUK', productId: 'p' } };
    const findMany = jest.fn().mockResolvedValue([row]);
    const r = prismaWith({ stockMovement: { findMany } });
    expect(await r.lossAdjustments([D1], FROM, TO)).toEqual([
      { id: 'm', itemId: 'i', depotId: D1, itemType: 'PRODUK', productId: 'p', delta: -1, reason: null, createdAt: TO },
    ]);
    await r.opnameMovements([D1], FROM, TO);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ type: 'ADJUSTMENT', delta: { lt: 0 }, createdAt: { gte: FROM, lt: TO } });
    // lent gallons and rejected-count reversals are left out IN THE QUERY, and a movement with no reason stays in
    expect(findMany.mock.calls[0][0].where.OR).toEqual([
      { reason: null },
      { AND: [{ NOT: { reason: { startsWith: LENT_GALLON_REASON } } }, { NOT: { reason: { startsWith: OPNAME_REVERSAL_REASON } } }] },
    ]);
    expect(findMany.mock.calls[1][0].where).toMatchObject({ type: 'OPNAME', createdAt: { gte: FROM, lt: TO } });
  });

  it('reads rejected opname approvals and tolerates a payload without a line', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { depotId: D1, createdAt: FROM, payload: { itemId: 'i', variance: -2 } },
      { depotId: D1, createdAt: FROM, payload: { counted: 1 } },
      { depotId: D1, createdAt: FROM, payload: null },
    ]);
    const rows = await prismaWith({ approval: { findMany } }).rejectedOpnames([D1], FROM, TO);
    expect(rows.map((x) => [x.itemId, x.variance])).toEqual([['i', -2], [null, null], [null, null]]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ type: 'OPNAME_VARIANCE', status: 'REJECTED' });
  });

  it('reads the newest received orders of each depot, bounded, and a lines column that is not a list as no lines', async () => {
    const findMany = jest.fn().mockImplementation(async (args: { where: { depotId: string } }) => [
      { depotId: args.where.depotId, status: 'RECEIVED', createdAt: FROM, receivedAt: TO, lines: args.where.depotId === D1 ? [{ quantity: 1 }] : null },
    ]);
    const ids = Array.from({ length: 23 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const rows = await prismaWith({ purchaseOrder: { findMany } }).receivedPurchaseOrders([D1, ...ids], TO);
    expect(rows).toHaveLength(24);
    expect(rows[0].lines).toHaveLength(1);
    expect(rows[1].lines).toHaveLength(0);
    expect(findMany).toHaveBeenCalledTimes(24);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { receivedAt: 'desc' },
      take: PRICE_ORDERS_PER_DEPOT,
      where: { depotId: D1, status: 'RECEIVED', receivedAt: { lte: TO } },
    });
  });

  it('reads the sent orders of the depots, and refuses past the cap', async () => {
    const findMany = jest.fn().mockResolvedValue([{ depotId: D1, status: 'SENT', createdAt: FROM, receivedAt: null, lines: [] }]);
    const r = prismaWith({ purchaseOrder: { findMany } });
    expect(await r.sentPurchaseOrders([D1])).toHaveLength(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ depotId: { in: [D1] }, status: 'SENT' });
    findMany.mockResolvedValue(new Array(AI_STOCK_ROW_CAP + 1).fill({}));
    await expect(r.sentPurchaseOrders([D1])).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('reads the damaged returns of the window, one row each', async () => {
    const rows = [{ depotId: D1, quantity: 2, createdAt: FROM }];
    const findMany = jest.fn().mockResolvedValue(rows);
    expect(await prismaWith({ gallonReturn: { findMany } }).damagedGallons([D1, D2], FROM, TO)).toEqual(rows);
    expect(findMany.mock.calls[0][0].where).toEqual({ depotId: { in: [D1, D2] }, condition: 'DAMAGED', createdAt: { gte: FROM, lt: TO } });
  });
});

describe('AiStockController and its DTOs', () => {
  it('passes the depots and the window to the service', async () => {
    const stock = {
      stockPosition: jest.fn().mockResolvedValue([1]),
      wastage: jest.fn().mockResolvedValue([2]),
      opname: jest.fn().mockResolvedValue([3]),
      openPurchases: jest.fn().mockResolvedValue([4]),
    };
    const c = new AiStockController(stock as unknown as AiStockService);
    const q = { depotIds: `${D1},${D2}`, from: FROM.toISOString(), to: TO.toISOString() };
    expect(await c.position(q)).toEqual({ items: [1] });
    expect(await c.wastage(q)).toEqual({ items: [2] });
    expect(await c.opname(q)).toEqual({ items: [3] });
    expect(await c.openPurchases(q)).toEqual({ items: [4] });
    expect(stock.openPurchases).toHaveBeenCalledWith([D1, D2]);
    expect(stock.wastage).toHaveBeenCalledWith([D1, D2], FROM, TO);
  });

  it('wants at most 100 depot ids, uuids only, and a window of from <= to within a leap year', async () => {
    const depots = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
    const ids = async (depotIds: string) => validate(plainToInstance(AiStockDepotsQueryDto, { depotIds }));
    expect(await ids(depots(100))).toHaveLength(0);
    expect(await ids(depots(101))).not.toHaveLength(0);
    expect(await ids('not-a-uuid')).not.toHaveLength(0);
    const win = (o: object) =>
      validate(plainToInstance(AiStockWindowQueryDto, { depotIds: D1, from: FROM.toISOString(), to: TO.toISOString(), ...o }));
    expect(await win({})).toHaveLength(0);
    expect(await win({ to: '2026-01-01T00:00:00.000Z' })).not.toHaveLength(0);
    expect(await win({ to: '2028-01-01T00:00:00.000Z' })).not.toHaveLength(0);
  });
});
