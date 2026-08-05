import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CashbookPrismaRepository } from '../../src/infrastructure/prisma/cashbook.prisma.repository';
import { DepotPrismaRepository } from '../../src/infrastructure/prisma/depot.prisma.repository';
import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';
import { GallonReturnPrismaRepository } from '../../src/infrastructure/prisma/gallon-return.prisma.repository';
import { IncidentPrismaRepository } from '../../src/infrastructure/prisma/incident.prisma.repository';
import { InventoryPrismaRepository } from '../../src/infrastructure/prisma/inventory.prisma.repository';
import { MaintenancePrismaRepository } from '../../src/infrastructure/prisma/maintenance.prisma.repository';
import { PricingRulePrismaRepository } from '../../src/infrastructure/prisma/pricing-rule.prisma.repository';
import { PurchaseOrderPrismaRepository } from '../../src/infrastructure/prisma/purchase-order.prisma.repository';
import { SubscriptionPrismaRepository } from '../../src/infrastructure/prisma/subscription.prisma.repository';
import { HandoverPrismaRepository } from '../../src/infrastructure/prisma/handover.prisma.repository';

// Covers the null-aggregate `?? 0` fallbacks and the not-found `row ? … : null` branches that
// only fire on empty data — the happy-path prisma-repositories.spec always has rows/sums.

describe('prisma repository null/empty branches', () => {
  it('falls back to 0 for null gallon-issue aggregates', async () => {
    const gallonIssue = {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _count: { _all: 0 }, _sum: { quantity: null, depositHeld: null } }),
      groupBy: jest
        .fn()
        .mockResolvedValue([{ depotId: 'd', _sum: { quantity: null, depositHeld: null } }]),
    };
    const repo = new GallonIssuePrismaRepository({ gallonIssue } as unknown as PrismaService);
    expect(await repo.summaryForDepot('d')).toEqual({ issues: 0, gallons: 0, depositHeld: 0 });
    expect(await repo.networkSummary()).toEqual([{ depotId: 'd', gallons: 0, depositHeld: 0 }]);
  });

  it('falls back to 0 for null gallon-return network aggregates', async () => {
    const gallonReturn = {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ depotId: 'd', _sum: { quantity: null, depositRefunded: null } }]),
    };
    const repo = new GallonReturnPrismaRepository({ gallonReturn } as unknown as PrismaService);
    expect(await repo.networkSummary()).toEqual([{ depotId: 'd', gallons: 0, depositRefunded: 0 }]);
  });

  it('returns null from incident findById when the row is missing', async () => {
    const incident = {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const repo = new IncidentPrismaRepository({ incident } as unknown as PrismaService);
    expect(await repo.findById('x')).toBeNull();
    await repo.listForDepot('d');
    await repo.listForDepot('d', 'OPEN' as never);
    expect(incident.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns null from subscription findById when the row is missing', async () => {
    const subscription = {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const repo = new SubscriptionPrismaRepository({ subscription } as unknown as PrismaService);
    expect(await repo.findById('x')).toBeNull();
    await repo.listForDepot('d');
    await repo.listForDepot('d', 'ACTIVE' as never);
    expect(subscription.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns null from handover findById when the row is missing', async () => {
    const shiftHandover = { findUnique: jest.fn().mockResolvedValue(null) };
    const repo = new HandoverPrismaRepository({ shiftHandover } as unknown as PrismaService);
    expect(await repo.findById('x')).toBeNull();
  });

  // The mirror of the misses above: every findById is a `row ? map(row) : null` ternary and
  // the row-present arm was only ever exercised for some of these repositories.
  it('maps the found row on findById across the record repositories', async () => {
    const cases: {
      model: string;
      make: (p: PrismaService) => { findById(id: string): Promise<unknown> };
    }[] = [
      { model: 'shiftHandover', make: (p) => new HandoverPrismaRepository(p) },
      { model: 'incident', make: (p) => new IncidentPrismaRepository(p) },
      { model: 'maintenanceItem', make: (p) => new MaintenancePrismaRepository(p) },
      { model: 'pricingRule', make: (p) => new PricingRulePrismaRepository(p) },
      { model: 'purchaseOrder', make: (p) => new PurchaseOrderPrismaRepository(p) },
      { model: 'subscription', make: (p) => new SubscriptionPrismaRepository(p) },
    ];
    for (const { model, make } of cases) {
      const findUnique = jest.fn().mockResolvedValue({ id: 'row-1' });
      const repo = make({ [model]: { findUnique } } as unknown as PrismaService);
      expect(await repo.findById('row-1')).toMatchObject({ id: 'row-1' });
    }
  });

  it('builds a to-only cashbook window (no gte side)', async () => {
    const cashbookEntry = { findMany: jest.fn().mockResolvedValue([]) };
    const repo = new CashbookPrismaRepository({ cashbookEntry } as unknown as PrismaService);
    const to = new Date('2026-01-31');
    await repo.listForDepot('depot-1', { to });
    expect(cashbookEntry.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', occurredAt: { lte: to } },
      orderBy: { occurredAt: 'desc' },
    });
  });

  it('coerces null depot operatingHours/holidays json to empty', async () => {
    const depot = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'depot-1',
        ownershipType: 'HKP',
        deliveryFee: { toNumber: () => 5000 },
        minOrderAmount: null,
        operatingHours: null,
        holidays: null,
      }),
    };
    const repo = new DepotPrismaRepository({ depot } as unknown as PrismaService);
    const out = await repo.findById('depot-1', false);
    expect(out?.operatingHours).toEqual({});
    expect(out?.holidays).toEqual([]);
  });
});

describe('InventoryPrismaRepository filter/lock branches', () => {
  const stockMovement = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const inventoryItem = { update: jest.fn().mockResolvedValue({}) };
  const stockReservation = {
    create: jest.fn().mockResolvedValue({}),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const $queryRaw = jest.fn();
  const $executeRaw = jest.fn();
  const prisma = {
    stockMovement,
    inventoryItem,
    stockReservation,
    $queryRaw,
    $executeRaw,
  } as unknown as PrismaService;
  // Interactive-callback form only: reserveAtomic locks rows inside one transaction.
  (prisma as unknown as { $transaction: unknown }).$transaction = (fn: (tx: unknown) => unknown) =>
    fn(prisma);
  const repo = new InventoryPrismaRepository(prisma);
  const FROM = new Date('2026-07-01T00:00:00.000Z');
  const TO = new Date('2026-08-01T00:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('omits createdAt and type entirely when the movement filter carries neither', async () => {
    await repo.listForDepotMovements('depot-1', { page: 1, limit: 20 });
    expect(stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { item: { depotId: 'depot-1' } } }),
    );
  });

  it('builds one-sided movement and wastage windows', async () => {
    await repo.listForDepotMovements('depot-1', { from: FROM, page: 1, limit: 20 });
    expect(stockMovement.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { item: { depotId: 'depot-1' }, createdAt: { gte: FROM } },
      }),
    );
    await repo.listForDepotMovements('depot-1', { to: TO, page: 1, limit: 20 });
    expect(stockMovement.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { item: { depotId: 'depot-1' }, createdAt: { lt: TO } } }),
    );
    await repo.wastageAdjustments('depot-1', { from: FROM });
    expect(stockMovement.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { gte: FROM } }),
      }),
    );
    await repo.wastageAdjustments('depot-1', { to: TO });
    expect(stockMovement.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: { lt: TO } }) }),
    );
  });

  it('keeps an already-sorted and an equal-id lock order stable', async () => {
    $queryRaw.mockResolvedValue([
      { id: 'a', quantity: 100, reserved: 0 },
      { id: 'b', quantity: 100, reserved: 0 },
    ]);
    await repo.reserveAtomic(
      [
        { itemId: 'a', quantity: 1 },
        { itemId: 'b', quantity: 1 },
      ],
      'ord-1',
    );
    expect(stockReservation.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        { itemId: 'a', orderId: 'ord-1', quantity: 1 },
        { itemId: 'b', orderId: 'ord-1', quantity: 1 },
      ],
    });
    await repo.reserveAtomic(
      [
        { itemId: 'a', quantity: 1 },
        { itemId: 'a', quantity: 1 },
      ],
      'ord-2',
    );
    // Two duplicate plans still produce two reservation rows — the unique (itemId, orderId)
    // index is what rejects them, exactly as when they were two separate inserts.
    expect(stockReservation.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        { itemId: 'a', orderId: 'ord-2', quantity: 1 },
        { itemId: 'a', orderId: 'ord-2', quantity: 1 },
      ],
    });
  });

  it('treats a vanished row as zero sellable stock, not a crash', async () => {
    $queryRaw.mockResolvedValue([]);
    const out = await repo.reserveAtomic([{ itemId: 'gone', quantity: 1 }], 'ord-3');
    expect(out.shortfalls).toEqual([{ itemId: 'gone', requested: 1, available: 0 }]);
  });
});
