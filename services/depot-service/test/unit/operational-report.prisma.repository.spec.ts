import { InventoryItemType } from '../../src/domain/inventory';
import { OperationalReportPrismaRepository } from '../../src/infrastructure/prisma/operational-report.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('OperationalReportPrismaRepository', () => {
  const stockMovement = { findMany: jest.fn() };
  const purchaseOrder = { findMany: jest.fn() };
  const cashbookEntry = { findMany: jest.fn() };
  const prisma = { stockMovement, purchaseOrder, cashbookEntry } as unknown as PrismaService;
  const repository = new OperationalReportPrismaRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    stockMovement.findMany.mockResolvedValue([]);
    purchaseOrder.findMany.mockResolvedValue([]);
    cashbookEntry.findMany.mockResolvedValue([]);
  });

  it('loads only period sales/outflows and received POs available before range end', async () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');
    await repository.load('depot-1', { from, to });

    expect(stockMovement.findMany).toHaveBeenCalledWith({
      where: { type: 'SALE', createdAt: { gte: from, lt: to }, item: { depotId: 'depot-1' } },
      select: {
        id: true,
        itemId: true,
        delta: true,
        createdAt: true,
        item: { select: { itemType: true, label: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(purchaseOrder.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', status: 'RECEIVED', receivedAt: { not: null, lt: to } },
      select: { id: true, poNumber: true, receivedAt: true, lines: true },
      orderBy: [{ receivedAt: 'asc' }, { poNumber: 'asc' }],
    });
    expect(cashbookEntry.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', direction: 'OUT', occurredAt: { gte: from, lt: to } },
      select: { id: true, category: true, amountIdr: true, sourceRef: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
  });

  it('maps negative SALE deltas to positive sold units and preserves PO/cashbook identity', async () => {
    const occurredAt = new Date('2026-07-10T00:00:00.000Z');
    stockMovement.findMany.mockResolvedValue([
      {
        id: 'move-1',
        itemId: 'item-1',
        delta: -3,
        createdAt: occurredAt,
        item: { itemType: InventoryItemType.PRODUK, label: 'Refill 19L' },
      },
    ]);
    purchaseOrder.findMany.mockResolvedValue([
      {
        id: 'po-id',
        poNumber: 'PO-1',
        receivedAt: occurredAt,
        lines: [{ itemType: InventoryItemType.PRODUK, label: 'Refill 19L', quantity: 10, unitCostIdr: 4500 }],
      },
    ]);
    cashbookEntry.findMany.mockResolvedValue([
      { id: 'cash-1', category: 'PO', amountIdr: 45_000, sourceRef: 'PO-1', occurredAt },
    ]);

    const result = await repository.load('depot-1', {
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(result.sales[0]).toMatchObject({ quantitySold: 3, label: 'Refill 19L' });
    expect(result.receivedPurchaseOrders[0]).toMatchObject({ id: 'po-id', poNumber: 'PO-1' });
    expect(result.outflows[0]).toMatchObject({ id: 'cash-1', sourceRef: 'PO-1' });
  });
});
