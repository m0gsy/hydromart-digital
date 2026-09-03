import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ApprovalPrismaRepository } from '../../src/infrastructure/prisma/approval.prisma.repository';
import { CashbookPrismaRepository } from '../../src/infrastructure/prisma/cashbook.prisma.repository';
import { DepotTargetPrismaRepository } from '../../src/infrastructure/prisma/depot-target.prisma.repository';
import { DepotPrismaRepository } from '../../src/infrastructure/prisma/depot.prisma.repository';
import { DisputePrismaRepository } from '../../src/infrastructure/prisma/dispute.prisma.repository';
import { FranchiseApplicationPrismaRepository } from '../../src/infrastructure/prisma/franchise-application.prisma.repository';
import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';
import { GallonReturnPrismaRepository } from '../../src/infrastructure/prisma/gallon-return.prisma.repository';
import { HandoverPrismaRepository } from '../../src/infrastructure/prisma/handover.prisma.repository';
import { HuddlePrismaRepository } from '../../src/infrastructure/prisma/huddle.prisma.repository';
import { IncidentPrismaRepository } from '../../src/infrastructure/prisma/incident.prisma.repository';
import { InventoryPrismaRepository } from '../../src/infrastructure/prisma/inventory.prisma.repository';
import { MaintenancePrismaRepository } from '../../src/infrastructure/prisma/maintenance.prisma.repository';
import { PriceOverrideProposalPrismaRepository } from '../../src/infrastructure/prisma/price-override-proposal.prisma.repository';
import { PricingRulePrismaRepository } from '../../src/infrastructure/prisma/pricing-rule.prisma.repository';
import { PurchaseOrderPrismaRepository } from '../../src/infrastructure/prisma/purchase-order.prisma.repository';
import { RosterPrismaRepository } from '../../src/infrastructure/prisma/roster.prisma.repository';
import { SubscriptionPrismaRepository } from '../../src/infrastructure/prisma/subscription.prisma.repository';
import { SupplierPrismaRepository } from '../../src/infrastructure/prisma/supplier.prisma.repository';
import { WholesaleTierPrismaRepository } from '../../src/infrastructure/prisma/wholesale-tier.prisma.repository';
import { ApprovalStatus, ApprovalType } from '../../src/domain/approval';
import {
  InventoryItemType,
  ReservationStatus,
  StockMovementType,
} from '../../src/domain/inventory';
import { GallonCondition } from '../../src/domain/gallon-return';
import { NegativeStockError } from '../../src/domain/errors';

// Unit-tests every depot-service Prisma repository against a per-model jest.fn() mock of
// PrismaService. No real database, no testcontainers: each test asserts the EXACT prisma call
// args (where/select/orderBy/data) and the row->record mapping. Mirrors
// services/customer-service/test/unit/prisma-repositories.spec.ts.

// A Prisma Decimal stand-in: repos call either `.toNumber()` (depot) or `Number(x)` (the rest),
// so provide both a toNumber() method and a valueOf() Number() can coerce.
const decimal = (n: number) => ({ toNumber: () => n, valueOf: () => n });

describe('ApprovalPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  };
  const prisma = { approval: model } as unknown as PrismaService;
  const repo = new ApprovalPrismaRepository(prisma);

  it('counts only the approvals a PERSON decided in the window', async () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');
    model.count.mockResolvedValue(3);
    await expect(repo.countReviewedInRange('d1', from, to)).resolves.toBe(3);
    // `decidedBy: not null` is the whole point: an under-threshold approval is stored
    // APPROVED with a decidedAt and no decider.
    expect(model.count).toHaveBeenCalledWith({
      where: { depotId: 'd1', decidedBy: { not: null }, decidedAt: { gte: from, lt: to } },
    });
  });
  const row = {
    id: 'ap-1',
    depotId: 'depot-1',
    type: 'OPNAME_VARIANCE',
    status: 'PENDING',
    title: 'Opname loss',
    submittedBy: 'op-1',
    subjectRef: null,
    amountIdr: 50000,
    payload: { variance: -3 },
    autoPassThreshold: 10000,
    decisionNote: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, casting payload and mapping enums', async () => {
    model.create.mockResolvedValue(row);
    const data = {
      depotId: 'depot-1',
      type: ApprovalType.OPNAME_VARIANCE,
      payload: { variance: -3 },
    } as never;
    const out = await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({
      data: { depotId: 'depot-1', type: ApprovalType.OPNAME_VARIANCE, payload: { variance: -3 } },
    });
    expect(out.type).toBe(ApprovalType.OPNAME_VARIANCE);
    expect(out.status).toBe(ApprovalStatus.PENDING);
    expect(out.payload).toEqual({ variance: -3 });
  });

  it('coerces a null payload to an empty object', async () => {
    model.create.mockResolvedValue({ ...row, payload: null });
    const out = await repo.create({} as never);
    expect(out.payload).toEqual({});
  });

  it('lists for a depot without a status filter, newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.listForDepot('depot-1');
    expect(out).toHaveLength(1);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('lists for a depot with a status filter', async () => {
    model.findMany.mockResolvedValue([]);
    await repo.listForDepot('depot-1', ApprovalStatus.APPROVED);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', status: ApprovalStatus.APPROVED },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
    model.findUnique.mockResolvedValue(row);
    expect((await repo.findById('ap-1'))?.id).toBe('ap-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'ap-1' } });
  });

  it('updates by id and maps the result', async () => {
    model.update.mockResolvedValue({ ...row, status: 'APPROVED' });
    const out = await repo.update('ap-1', { status: ApprovalStatus.APPROVED } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'ap-1' },
      data: { status: ApprovalStatus.APPROVED },
    });
    expect(out.status).toBe(ApprovalStatus.APPROVED);
  });

  it('builds pending counts per type, defaulting missing types to zero', async () => {
    model.groupBy.mockResolvedValue([
      { type: 'OPNAME_VARIANCE', _count: { _all: 2 } },
      { type: 'COD_VARIANCE', _count: { _all: 5 } },
    ]);
    const out = await repo.pendingCounts('depot-1');
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['type'],
      where: { depotId: 'depot-1', status: ApprovalStatus.PENDING },
      _count: { _all: true },
    });
    expect(out).toEqual({
      OPNAME_VARIANCE: 2,
      DEPOSIT_REFUND: 0,
      COD_VARIANCE: 5,
      GALLON_VARIANCE: 0,
    });
  });
});

describe('CashbookPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn() };
  const prisma = { cashbookEntry: model } as unknown as PrismaService;
  const repo = new CashbookPrismaRepository(prisma);
  const row = {
    id: 'cb-1',
    depotId: 'depot-1',
    direction: 'IN',
    category: 'SALE',
    label: 'Cash sale',
    amountIdr: 20000,
    occurredAt: new Date('2026-01-02'),
    sourceRef: null,
    actorId: 'op-1',
    createdAt: new Date('2026-01-02'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and maps direction', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.direction).toBe('IN');
  });

  it('lists without a date range (no occurredAt filter)', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.listForDepot('depot-1', {});
    expect(out).toHaveLength(1);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { occurredAt: 'desc' },
    });
  });

  it('lists with a from-only range', async () => {
    model.findMany.mockResolvedValue([]);
    const from = new Date('2026-01-01');
    await repo.listForDepot('depot-1', { from });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', occurredAt: { gte: from } },
      orderBy: { occurredAt: 'desc' },
    });
  });

  it('lists with a full from/to range', async () => {
    model.findMany.mockResolvedValue([]);
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    await repo.listForDepot('depot-1', { from, to });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: 'desc' },
    });
  });
});

describe('DepotTargetPrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { depotTarget: model } as unknown as PrismaService;
  const repo = new DepotTargetPrismaRepository(prisma);
  const row = { depotId: 'depot-1', month: '2026-01', revenueTargetIdr: 1000000 };

  beforeEach(() => jest.clearAllMocks());

  it('finds by composite depotId_month key', async () => {
    model.findUnique.mockResolvedValue(row);
    expect(await repo.findByDepotMonth('depot-1', '2026-01')).toBe(row);
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { depotId_month: { depotId: 'depot-1', month: '2026-01' } },
    });
  });

  it('returns null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByDepotMonth('depot-1', '2099-01')).toBeNull();
  });

  it('upserts splitting the key from the update values', async () => {
    model.upsert.mockResolvedValue(row);
    const data = { depotId: 'depot-1', month: '2026-01', revenueTargetIdr: 1000000 } as never;
    await repo.upsert(data);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { depotId_month: { depotId: 'depot-1', month: '2026-01' } },
      create: data,
      update: { revenueTargetIdr: 1000000 },
    });
  });
});

describe('DepotPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { depot: model } as unknown as PrismaService;
  const repo = new DepotPrismaRepository(prisma);
  const row = {
    id: 'depot-1',
    code: 'DPT001',
    name: 'Depot Satu',
    ownershipType: 'WARALABA',
    address: 'Jl. Air 1',
    city: 'Jakarta',
    province: 'DKI',
    lat: -6.2,
    lng: 106.8,
    serviceRadiusKm: 5,
    deliveryFee: decimal(5000),
    minOrderAmount: decimal(20000),
    ownerId: null,
    paymentBankName: null,
    paymentBankAccountNumber: null,
    paymentBankAccountHolder: null,
    paymentQrisImageUrl: null,
    operatingHours: { mon: '08-17' },
    holidays: [{ date: '2026-01-01' }],
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  // Audit S-19 and its Q-17 baseline row: 47 call sites asked "does this depot exist" by
  // reading the whole row. Nothing deletes a depot, so a yes is remembered; a no always
  // goes back to the database, which is what lets a depot created a second ago be found.
  it('remembers a depot exists, but never that one does not', async () => {
    const fresh = new DepotPrismaRepository(prisma);
    model.findUnique.mockResolvedValue(null);
    expect(await fresh.exists('dep-x')).toBe(false);
    expect(await fresh.exists('dep-x')).toBe(false);
    expect(model.findUnique).toHaveBeenCalledTimes(2);

    model.findUnique.mockResolvedValue({ id: 'dep-x' });
    expect(await fresh.exists('dep-x')).toBe(true);
    expect(await fresh.exists('dep-x')).toBe(true);
    expect(model.findUnique).toHaveBeenCalledTimes(3);
  });

  /*
   * The batched name lookup the customer deposit card uses. It replaced one `findById` per
   * depot — an N+1 that is invisible on seed data because N is "how many depots has this
   * person used", which is exactly why it survived until somebody looked for the shape.
   */
  describe('findManyByIds', () => {
    it('asks once, de-duplicates, and honours activeOnly', async () => {
      model.findMany.mockResolvedValue([row]);
      const out = await repo.findManyByIds(['d1', 'd1', 'd2'], true);
      expect(model.findMany).toHaveBeenCalledTimes(1);
      expect(model.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1', 'd2'] }, active: true },
      });
      expect(out).toHaveLength(1);
    });

    it('omits the active filter when it is not asked for', async () => {
      model.findMany.mockResolvedValue([]);
      await repo.findManyByIds(['d1'], false);
      expect(model.findMany).toHaveBeenCalledWith({ where: { id: { in: ['d1'] } } });
    });

    // An empty `in` list is a round trip that can only ever return nothing.
    it('does not query at all for an empty list', async () => {
      model.findMany.mockClear();
      await expect(repo.findManyByIds([], false)).resolves.toEqual([]);
      expect(model.findMany).not.toHaveBeenCalled();
    });
  });

  it('searches with paging and no filters, mapping decimals/json', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.search({ page: 2, limit: 10 } as never);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { code: 'asc' },
      skip: 10,
      take: 10,
    });
    expect(model.count).toHaveBeenCalledWith({ where: {} });
    expect(out.total).toBe(1);
    expect(out.items[0].deliveryFee).toBe(5000);
    expect(out.items[0].minOrderAmount).toBe(20000);
    expect(out.items[0].operatingHours).toEqual({ mon: '08-17' });
    expect(out.items[0].holidays).toEqual([{ date: '2026-01-01' }]);
    expect(out.items[0].ownershipType).toBe('WARALABA');
  });

  it('searches applying activeOnly, ownershipType and case-insensitive OR search', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.search({
      page: 1,
      limit: 5,
      activeOnly: true,
      ownershipType: 'HKP',
      search: 'sat',
    } as never);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        ownershipType: 'HKP',
        OR: [
          { name: { contains: 'sat', mode: 'insensitive' } },
          { code: { contains: 'sat', mode: 'insensitive' } },
          { city: { contains: 'sat', mode: 'insensitive' } },
        ],
      },
      orderBy: { code: 'asc' },
      skip: 0,
      take: 5,
    });
  });

  it('maps a null minOrderAmount to null', async () => {
    model.findFirst.mockResolvedValue({ ...row, minOrderAmount: null });
    const out = await repo.findById('depot-1', false);
    expect(out?.minOrderAmount).toBeNull();
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: 'depot-1' } });
  });

  it('findById applies the active filter when activeOnly', async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await repo.findById('depot-1', true)).toBeNull();
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: 'depot-1', active: true } });
  });

  it('finds by code', async () => {
    model.findUnique.mockResolvedValue(row);
    expect((await repo.findByCode('DPT001'))?.code).toBe('DPT001');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { code: 'DPT001' } });
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByCode('X')).toBeNull();
  });

  it('finds by owner ordered by code', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.findByOwner('own-1');
    expect(out).toHaveLength(1);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { ownerId: 'own-1' },
      orderBy: { code: 'asc' },
    });
  });

  it('creates, casting operatingHours/holidays json', async () => {
    model.create.mockResolvedValue(row);
    const data = { code: 'DPT002', operatingHours: { mon: '09-18' }, holidays: [] } as never;
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({
      data: { code: 'DPT002', operatingHours: { mon: '09-18' }, holidays: [] },
    });
  });

  it('updates, only including json fields that are provided', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('depot-1', { name: 'Renamed' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'depot-1' },
      data: { name: 'Renamed' },
    });

    await repo.update('depot-1', {
      name: 'R2',
      operatingHours: { mon: '10-19' },
      holidays: [{ date: 'x' }],
    } as never);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'depot-1' },
      data: { name: 'R2', operatingHours: { mon: '10-19' }, holidays: [{ date: 'x' }] },
    });
  });
});

describe('DisputePrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { orderDispute: model } as unknown as PrismaService;
  const repo = new DisputePrismaRepository(prisma);
  const row = {
    id: 'dp-1',
    depotId: 'depot-1',
    orderRef: 'ORD-1',
    customerName: 'Budi',
    category: 'WRONG_ITEM',
    description: 'x',
    amountIdr: 10000,
    courierName: null,
    status: 'OPEN',
    resolution: null,
    resolutionNote: null,
    raisedBy: 'op-1',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and maps enums, resolution null default', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.category).toBe('WRONG_ITEM');
    expect(out.status).toBe('OPEN');
    expect(out.resolution).toBeNull();
  });

  it('lists for a depot with and without status', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.listForDepot('depot-1', 'RESOLVED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({
      where: { depotId: 'depot-1', status: 'RESOLVED' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('maps a set resolution through', async () => {
    model.findUnique.mockResolvedValue({ ...row, resolution: 'REFUND' });
    expect((await repo.findById('dp-1'))?.resolution).toBe('REFUND');
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('dp-1', { status: 'RESOLVED' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'dp-1' },
      data: { status: 'RESOLVED' },
    });
  });
});

describe('FranchiseApplicationPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };
  const prisma = { franchiseApplication: model } as unknown as PrismaService;
  const repo = new FranchiseApplicationPrismaRepository(prisma);
  const row = {
    id: 'fa-1',
    applicantName: 'Budi',
    applicantPhone: '+62800',
    proposedCode: 'DPT9',
    proposedName: 'Depot 9',
    city: 'Bandung',
    province: 'Jabar',
    lat: -6.9,
    lng: 107.6,
    investmentAmount: decimal(150000000),
    projectedMonthlyRevenue: decimal(30000000),
    checklist: { legal: true },
    stage: 'LEAD',
    submittedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, casting checklist and coercing decimals', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ applicantName: 'Budi', checklist: { legal: true } } as never);
    expect(model.create).toHaveBeenCalledWith({
      data: { applicantName: 'Budi', checklist: { legal: true } },
    });
    expect(out.investmentAmount).toBe(150000000);
    expect(out.projectedMonthlyRevenue).toBe(30000000);
    expect(out.checklist).toEqual({ legal: true });
    expect(out.stage).toBe('LEAD');
  });

  it('coerces a null checklist to empty object', async () => {
    model.create.mockResolvedValue({ ...row, checklist: null });
    expect((await repo.create({} as never)).checklist).toEqual({});
  });

  it('lists oldest-submitted-first with paging, no stage filter', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.list({ page: 1, limit: 20 } as never);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { submittedAt: 'asc' },
      skip: 0,
      take: 20,
    });
    expect(model.count).toHaveBeenCalledWith({ where: {} });
    expect(out.total).toBe(1);
  });

  it('lists filtering by stage with paging offset', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.list({ page: 3, limit: 10, stage: 'REVIEW' } as never);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { stage: 'REVIEW' },
      orderBy: { submittedAt: 'asc' },
      skip: 20,
      take: 10,
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    model.findUnique.mockResolvedValue(row);
    expect((await repo.findById('fa-1'))?.id).toBe('fa-1');
  });

  it('updates only provided fields (stage + checklist)', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('fa-1', { stage: 'APPROVED' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'fa-1' },
      data: { stage: 'APPROVED' },
    });

    await repo.update('fa-1', { checklist: { legal: false } } as never);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'fa-1' },
      data: { checklist: { legal: false } },
    });
  });
  it('purges only REJECTED applications older than the cutoff (D6)', async () => {
    model.deleteMany.mockResolvedValue({ count: 3 });
    const cutoff = new Date('2024-09-02T00:00:00Z');

    expect(await repo.purgeRejectedBefore(cutoff)).toBe(3);
    expect(model.deleteMany).toHaveBeenCalledWith({
      where: { stage: 'REJECTED', updatedAt: { lt: cutoff } },
    });
  });

  it('reports zero rather than throwing when nothing is old enough', async () => {
    model.deleteMany.mockResolvedValue({ count: 0 });
    expect(await repo.purgeRejectedBefore(new Date())).toBe(0);
  });

});

describe('GallonIssuePrismaRepository', () => {
  const model = {
    create: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  };
  const prisma = { gallonIssue: model } as unknown as PrismaService;
  const repo = new GallonIssuePrismaRepository(prisma);
  /** I4: what Prisma actually hands back for a Decimal column. */
  const decimal = (v: string) => ({ toString: () => v }) as unknown as number;
  const row = { id: 'gi-1', depotId: 'depot-1', quantity: 5, depositHeld: decimal('100000') };

  beforeEach(() => jest.clearAllMocks());

  it('creates and returns the row, coercing the Decimal deposit (I4)', async () => {
    model.create.mockResolvedValue(row);
    expect(await repo.create({ depotId: 'depot-1' } as never)).toEqual({
      ...row,
      depositHeld: 100000,
    });
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
  });

  /**
   * I4: `depositHeld` is Decimal now, matching the return side, so Prisma hands back a
   * Decimal object where the record promises a number. Left uncoerced it does not throw —
   * it CONCATENATES: `deposit + refund` becomes a string, and every balance in the domain
   * silently stops being arithmetic. That is what this pins.
   */
  it('never lets a Decimal deposit reach arithmetic as a string (I4)', async () => {
    model.create.mockResolvedValue({ ...row, depositHeld: decimal('20000.50') });
    const rec = await repo.create({ depotId: 'depot-1' } as never);
    expect(rec.depositHeld).toBe(20000.5);
    expect(typeof rec.depositHeld).toBe('number');
    expect(rec.depositHeld + 1).toBe(20001.5);
  });

  // I1: a completion fan-out is at-least-once, so this is called twice for the same order.
  // `update: {}` is what makes the second call a read — the ledger is append-only, and a
  // booking that already happened must not be restated at today's deposit rate.
  it('books a fulfilment issue idempotently on the order id', async () => {
    model.upsert.mockResolvedValue(row);
    const data = { depotId: 'depot-1', orderId: 'o-1', quantity: 2 } as never;
    expect(await repo.createFromOrder(data)).toEqual({ ...row, depositHeld: 100000 });
    expect(model.upsert).toHaveBeenCalledWith({
      where: { orderId: 'o-1' },
      create: data,
      update: {},
    });
  });

  // I2: the cap reads ONE customer's balance per return, so it needs a targeted aggregate —
  // `perCustomerForDepot` would read every customer of the depot to serve one refund.
  it('aggregates one customer’s issued gallons and deposit held', async () => {
    model.aggregate.mockResolvedValue({ _sum: { quantity: 5, depositHeld: 100000 } });
    await expect(repo.summaryForCustomerAtDepot('depot-1', 'c1')).resolves.toEqual({
      gallons: 5,
      amountIdr: 100000,
    });
    expect(model.aggregate).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', customerId: 'c1' },
      _sum: { quantity: true, depositHeld: true },
    });
  });

  // A customer who has never taken a gallon here reads as zero, not as null — the cap
  // subtracts these, and a null would make the arithmetic NaN and the comparison always
  // false, which is the leak wearing a different hat.
  it('reads a customer with no issues as zero, not null', async () => {
    model.aggregate.mockResolvedValue({ _sum: { quantity: null, depositHeld: null } });
    await expect(repo.summaryForCustomerAtDepot('depot-1', 'nobody')).resolves.toEqual({
      gallons: 0,
      amountIdr: 0,
    });
  });

  // I5: the same totals grouped the other way — one customer, every depot they have used.
  // I4: this read was opened by I5 while the column was still Int, so it never needed a
  // cast. It does now — and an uncast Decimal does not throw, it reaches the customer's own
  // deposit screen and concatenates instead of adding.
  it('groups one customer’s issues by depot, coercing the Decimal deposit', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: 'd1', _sum: { quantity: 5, depositHeld: decimal('100000') } },
      { depotId: 'd2', _sum: { quantity: null, depositHeld: null } },
    ]);
    await expect(repo.perDepotForCustomer('c1')).resolves.toEqual([
      { depotId: 'd1', gallons: 5, amountIdr: 100000 },
      { depotId: 'd2', gallons: 0, amountIdr: 0 },
    ]);
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['depotId'],
      where: { customerId: 'c1' },
      _sum: { quantity: true, depositHeld: true },
    });
  });

  it('reads one customer’s issues at one depot, newest first and capped', async () => {
    model.findMany.mockResolvedValue([row]);
    await expect(repo.listForCustomerAtDepot('depot-1', 'c1', 20)).resolves.toEqual([
      { ...row, depositHeld: 100000 },
    ]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', customerId: 'c1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  /*
   * J-2: issue totals per CUSTOMER at one depot. Rows with no customer are excluded in the
   * `where` — an anonymous counter issue is not somebody anybody can chase for a gallon.
   */
  it('groups issues per customer, skipping the ones with none', async () => {
    model.groupBy.mockResolvedValue([
      { customerId: 'c1', _sum: { quantity: 4, depositHeld: 80_000 } },
      { customerId: 'c2', _sum: { quantity: null, depositHeld: null } },
    ]);
    await expect(repo.perCustomerForDepot('depot-1')).resolves.toEqual([
      { customerId: 'c1', gallons: 4, amountIdr: 80_000 },
      // A group with no sum is 0, not NaN and not absent.
      { customerId: 'c2', gallons: 0, amountIdr: 0 },
    ]);
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['customerId'],
      where: { depotId: 'depot-1', customerId: { not: null } },
      _sum: { quantity: true, depositHeld: true },
    });
  });

  it('lists with paging plus total', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.listForDepot('depot-1', 2, 10);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(model.count).toHaveBeenCalledWith({ where: { depotId: 'depot-1' } });
    expect(out).toEqual({ items: [{ ...row, depositHeld: 100000 }], total: 1 });
  });

  it('summarises a depot, defaulting null sums to zero', async () => {
    model.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { quantity: 12, depositHeld: null },
    });
    const out = await repo.summaryForDepot('depot-1');
    expect(model.aggregate).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      _count: { _all: true },
      _sum: { quantity: true, depositHeld: true },
    });
    expect(out).toEqual({ issues: 3, gallons: 12, depositHeld: 0 });
  });

  it('rolls up a network summary per depot', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: 'depot-1', _sum: { quantity: 5, depositHeld: 100000 } },
    ]);
    const out = await repo.networkSummary();
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['depotId'],
      _sum: { quantity: true, depositHeld: true },
    });
    expect(out).toEqual([{ depotId: 'depot-1', gallons: 5, depositHeld: 100000 }]);
  });
});

describe('GallonReturnPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  };
  const prisma = { gallonReturn: model } as unknown as PrismaService;
  const repo = new GallonReturnPrismaRepository(prisma);

  // MONEY-04. The courier handover arrives through the offline queue, which is
  // at-least-once, and the old bare `create` refunded the deposit a second time on every
  // retry. These four cases are the whole idempotency contract.
  describe('createFromOrder', () => {
    const data = {
      depotId: 'd1',
      customerId: 'c1',
      orderId: 'o1',
      quantity: 2,
      condition: GallonCondition.GOOD,
      depositRefunded: 40000,
      note: null,
      actorId: 'courier-1',
    };
    const row = { ...data, id: 'r1', depositRefunded: decimal(40000), createdAt: new Date() };

    beforeEach(() => {
      model.findUnique.mockReset();
      model.create.mockReset();
    });

    it('writes the row the first time', async () => {
      model.findUnique.mockResolvedValue(null);
      model.create.mockResolvedValue(row);
      const out = await repo.createFromOrder(data);
      expect(out.created).toBe(true);
      expect(out.record.depositRefunded).toBe(40000);
      expect(model.create).toHaveBeenCalledWith({ data });
    });

    // The offline queue's own retry, minutes later after its backoff.
    it('returns the first row and writes nothing when the order is already booked', async () => {
      model.findUnique.mockResolvedValue(row);
      const out = await repo.createFromOrder(data);
      expect(out.created).toBe(false);
      expect(out.record.id).toBe('r1');
      expect(model.create).not.toHaveBeenCalled();
    });

    // Two flushes racing: both misses, one create wins, the loser re-reads.
    it('re-reads the winner when a concurrent flush took the unique index', async () => {
      model.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
      model.create.mockRejectedValue({ code: 'P2002' });
      const out = await repo.createFromOrder(data);
      expect(out.created).toBe(false);
      expect(out.record.id).toBe('r1');
    });

    // A P2002 with nothing to read back is a DIFFERENT unique index, and swallowing it
    // would report a refund that was never written.
    it('rethrows a P2002 that leaves nothing to read back', async () => {
      const err = { code: 'P2002' };
      model.findUnique.mockResolvedValue(null);
      model.create.mockRejectedValue(err);
      await expect(repo.createFromOrder(data)).rejects.toBe(err);
    });

    it('rethrows any other prisma error', async () => {
      const err = { code: 'P2003' };
      model.findUnique.mockResolvedValue(null);
      model.create.mockRejectedValue(err);
      await expect(repo.createFromOrder(data)).rejects.toBe(err);
    });
  });

  // I2's other half. `depositRefunded` is a Decimal column, so the sum arrives as an object
  // and has to be coerced — subtracting it raw would give NaN and let every refund through.
  it('aggregates one customer’s returned gallons and refunded deposit', async () => {
    model.aggregate.mockResolvedValue({
      _sum: { quantity: 3, depositRefunded: { toString: () => '60000' } },
    });
    await expect(repo.summaryForCustomerAtDepot('depot-1', 'c1')).resolves.toEqual({
      gallons: 3,
      amountIdr: 60000,
    });
    expect(model.aggregate).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', customerId: 'c1' },
      _sum: { quantity: true, depositRefunded: true },
    });
  });

  it('reads a customer with no returns as zero, not null', async () => {
    model.aggregate.mockResolvedValue({ _sum: { quantity: null, depositRefunded: null } });
    await expect(repo.summaryForCustomerAtDepot('depot-1', 'nobody')).resolves.toEqual({
      gallons: 0,
      amountIdr: 0,
    });
  });

  // Same grouping on the return side, with the Decimal coercion its column needs.
  it('groups one customer’s returns by depot, coercing the Decimal refund', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: 'd1', _sum: { quantity: 3, depositRefunded: { toString: () => '60000' } } },
      { depotId: 'd2', _sum: { quantity: null, depositRefunded: null } },
    ]);
    await expect(repo.perDepotForCustomer('c1')).resolves.toEqual([
      { depotId: 'd1', gallons: 3, amountIdr: 60000 },
      { depotId: 'd2', gallons: 0, amountIdr: 0 },
    ]);
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['depotId'],
      where: { customerId: 'c1' },
      _sum: { quantity: true, depositRefunded: true },
    });
  });

  it('reads one customer’s returns at one depot, coercing the Decimal refund', async () => {
    model.findMany.mockResolvedValue([
      { id: 'gr-1', depotId: 'depot-1', customerId: 'c1', quantity: 2, condition: 'GOOD', depositRefunded: { toString: () => '40000' } },
    ]);
    await expect(repo.listForCustomerAtDepot('depot-1', 'c1', 20)).resolves.toEqual([
      expect.objectContaining({ id: 'gr-1', depositRefunded: 40_000 }),
    ]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', customerId: 'c1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });

  // J-2, the other half of the netting. `depositRefunded` is a Decimal column, so the sum
  // comes back as a Decimal and has to be coerced — a Decimal reaching the DTO serialises
  // as an object, not a number.
  it('groups returns per customer and coerces the Decimal refund', async () => {
    model.groupBy.mockResolvedValue([
      { customerId: 'c1', _sum: { quantity: 2, depositRefunded: { toString: () => '40000' } } },
      { customerId: 'c2', _sum: { quantity: null, depositRefunded: null } },
    ]);
    await expect(repo.perCustomerForDepot('depot-1')).resolves.toEqual([
      { customerId: 'c1', gallons: 2, amountIdr: 40_000 },
      { customerId: 'c2', gallons: 0, amountIdr: 0 },
    ]);
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['customerId'],
      where: { depotId: 'depot-1', customerId: { not: null } },
      _sum: { quantity: true, depositRefunded: true },
    });
  });

  const row = {
    id: 'gr-1',
    depotId: 'depot-1',
    customerId: null,
    orderId: null,
    quantity: 4,
    condition: 'GOOD',
    depositRefunded: decimal(80000),
    note: null,
    actorId: 'op-1',
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, mapping condition and coercing the decimal', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.condition).toBe(GallonCondition.GOOD);
    expect(out.depositRefunded).toBe(80000);
  });

  it('lists with paging plus total, mapping rows', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.listForDepot('depot-1', 1, 5);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 5,
    });
    expect(out.total).toBe(1);
    expect(out.items[0].depositRefunded).toBe(80000);
  });

  it('summarises with a separate damaged count, coercing refund decimal', async () => {
    model.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { quantity: 6, depositRefunded: decimal(120000) },
    });
    model.count.mockResolvedValue(1);
    const out = await repo.summaryForDepot('depot-1');
    expect(model.count).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', condition: GallonCondition.DAMAGED },
    });
    expect(out).toEqual({ returns: 2, gallons: 6, damaged: 1, depositRefunded: 120000 });
  });

  it('summarises defaulting a null refund sum to zero', async () => {
    model.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { quantity: null, depositRefunded: null },
    });
    model.count.mockResolvedValue(0);
    const out = await repo.summaryForDepot('depot-1');
    expect(out).toEqual({ returns: 0, gallons: 0, damaged: 0, depositRefunded: 0 });
  });

  // S2. Gallons, not slips, and half-open [from, to) — the daily report's own window, so a
  // return recorded at the stroke of midnight belongs to exactly one day.
  it('sums returned and damaged GALLONS over a half-open window', async () => {
    model.aggregate
      .mockResolvedValueOnce({ _sum: { quantity: 14 } })
      .mockResolvedValueOnce({ _sum: { quantity: 3 } });
    const from = new Date('2026-07-14T17:00:00.000Z');
    const to = new Date('2026-07-15T17:00:00.000Z');
    const out = await repo.gallonsInRange('depot-1', from, to);
    expect(model.aggregate).toHaveBeenNthCalledWith(1, {
      where: { depotId: 'depot-1', createdAt: { gte: from, lt: to } },
      _sum: { quantity: true },
    });
    expect(model.aggregate).toHaveBeenNthCalledWith(2, {
      where: { depotId: 'depot-1', createdAt: { gte: from, lt: to }, condition: GallonCondition.DAMAGED },
      _sum: { quantity: true },
    });
    expect(out).toEqual({ gallons: 14, damaged: 3 });
  });

  it('reads a window with no returns as zero, not as null', async () => {
    model.aggregate.mockResolvedValue({ _sum: { quantity: null } });
    expect(await repo.gallonsInRange('depot-1', new Date(), new Date())).toEqual({
      gallons: 0,
      damaged: 0,
    });
  });

  it('rolls up a network summary per depot', async () => {
    model.groupBy.mockResolvedValue([
      { depotId: 'depot-1', _sum: { quantity: 4, depositRefunded: decimal(80000) } },
    ]);
    const out = await repo.networkSummary();
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['depotId'],
      _sum: { quantity: true, depositRefunded: true },
    });
    expect(out).toEqual([{ depotId: 'depot-1', gallons: 4, depositRefunded: 80000 }]);
  });
});

describe('HandoverPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { shiftHandover: model } as unknown as PrismaService;
  const repo = new HandoverPrismaRepository(prisma);
  const row = {
    id: 'ho-1',
    depotId: 'depot-1',
    fromShift: 'PAGI',
    toShift: 'SORE',
    fromStaff: 'A',
    toStaff: 'B',
    items: [{ label: 'kas', value: '100000' }],
    note: null,
    signedAt: null,
    recordedBy: 'op-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, casting items json', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({
      depotId: 'depot-1',
      items: [{ label: 'kas', value: '100000' }],
    } as never);
    expect(model.create).toHaveBeenCalledWith({
      data: { depotId: 'depot-1', items: [{ label: 'kas', value: '100000' }] },
    });
    expect(out.items).toEqual([{ label: 'kas', value: '100000' }]);
  });

  it('coerces null items to empty array', async () => {
    model.create.mockResolvedValue({ ...row, items: null });
    expect((await repo.create({} as never)).items).toEqual([]);
  });

  it('lists for a depot newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('signs by id with a timestamp', async () => {
    const signedAt = new Date('2026-01-02');
    model.update.mockResolvedValue({ ...row, signedAt });
    const out = await repo.sign('ho-1', signedAt);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'ho-1' }, data: { signedAt } });
    expect(out.signedAt).toEqual(signedAt);
  });
});

describe('HuddlePrismaRepository', () => {
  const model = { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() };
  const prisma = { huddleNote: model } as unknown as PrismaService;
  const repo = new HuddlePrismaRepository(prisma);
  const row = {
    id: 'hd-1',
    depotId: 'depot-1',
    weekStart: '2026-01-05',
    heldAt: new Date('2026-01-05'),
    attendance: '5/6',
    agenda: [{ topic: 't' }],
    actionItems: [{ task: 'a' }],
    recordedBy: 'op-1',
    createdAt: new Date('2026-01-05'),
    updatedAt: new Date('2026-01-05'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('upserts on the composite key with create+update json payloads', async () => {
    model.upsert.mockResolvedValue(row);
    const out = await repo.upsert({
      depotId: 'depot-1',
      weekStart: '2026-01-05',
      attendance: '5/6',
      agenda: [{ topic: 't' }],
      actionItems: [{ task: 'a' }],
      recordedBy: 'op-1',
    } as never);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { depotId_weekStart: { depotId: 'depot-1', weekStart: '2026-01-05' } },
      create: {
        depotId: 'depot-1',
        weekStart: '2026-01-05',
        attendance: '5/6',
        recordedBy: 'op-1',
        agenda: [{ topic: 't' }],
        actionItems: [{ task: 'a' }],
      },
      update: {
        attendance: '5/6',
        recordedBy: 'op-1',
        agenda: [{ topic: 't' }],
        actionItems: [{ task: 'a' }],
      },
    });
    expect(out.agenda).toEqual([{ topic: 't' }]);
    expect(out.actionItems).toEqual([{ task: 'a' }]);
  });

  it('finds a week, null on miss and coercing null json', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findForWeek('depot-1', '2026-01-05')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { depotId_weekStart: { depotId: 'depot-1', weekStart: '2026-01-05' } },
    });

    model.findUnique.mockResolvedValue({ ...row, agenda: null, actionItems: null });
    const out = await repo.findForWeek('depot-1', '2026-01-05');
    expect(out?.agenda).toEqual([]);
    expect(out?.actionItems).toEqual([]);
  });

  it('lists for a depot newest-week-first', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { weekStart: 'desc' },
    });
  });
});

describe('IncidentPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { incident: model } as unknown as PrismaService;
  const repo = new IncidentPrismaRepository(prisma);
  const row = {
    id: 'in-1',
    depotId: 'depot-1',
    type: 'SPILL',
    severity: 'HIGH',
    status: 'OPEN',
    title: 'Spill',
    description: null,
    reportedBy: 'op-1',
    courierName: null,
    orderRef: null,
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and maps enums', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.type).toBe('SPILL');
    expect(out.severity).toBe('HIGH');
    expect(out.status).toBe('OPEN');
  });

  it('lists with and without status', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.listForDepot('depot-1', 'RESOLVED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({
      where: { depotId: 'depot-1', status: 'RESOLVED' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('in-1', { status: 'RESOLVED' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'in-1' },
      data: { status: 'RESOLVED' },
    });
  });
});

describe('InventoryPrismaRepository', () => {
  const inventoryItem = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  };
  const stockMovement = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const stockReservation = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
  };
  const $queryRaw = jest.fn();
  const $executeRaw = jest.fn();
  // Support both array-form ($transaction([...]) -> Promise.all) and interactive callback form.
  const $transaction = jest
    .fn()
    .mockImplementation((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const prisma = {
    inventoryItem,
    stockMovement,
    stockReservation,
    $queryRaw,
    $executeRaw,
    $transaction,
  } as unknown as PrismaService;
  const repo = new InventoryPrismaRepository(prisma);
  const item = {
    id: 'it-1',
    depotId: 'depot-1',
    itemType: 'PRODUK',
    productId: 'prod-1',
    label: 'Aqua 600ml',
    unit: 'pcs',
    quantity: 10,
    reserved: 2,
    minimumStock: 3,
    sellPrice: 5000,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  // A catalog rename has to reach every depot's line for that product in one statement:
  // renaming them one by one would leave a half-renamed network if it failed midway.
  it('renames and hides every line for a product, returning the row count', async () => {
    inventoryItem.updateMany.mockResolvedValue({ count: 3 });
    expect(await repo.renameByProductId('prod-1', 'Nama Baru', 'Galon')).toBe(3);
    expect(inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { productId: 'prod-1' },
      data: { label: 'Nama Baru', unit: 'Galon' },
    });

    inventoryItem.updateMany.mockResolvedValue({ count: 2 });
    expect(await repo.setHiddenByProductId('prod-1', true)).toBe(2);
    expect(inventoryItem.updateMany).toHaveBeenLastCalledWith({
      where: { productId: 'prod-1' },
      data: { hidden: true },
    });
  });

  it('deletes a line by id', async () => {
    inventoryItem.delete.mockResolvedValue(item);
    await repo.deleteLine('it-1');
    expect(inventoryItem.delete).toHaveBeenCalledWith({ where: { id: 'it-1' } });
  });

  // Only ACTIVE holds: a released or consumed one is history, not something still keeping
  // units off the shelf.
  it('lists only the active reservations on a line, newest first', async () => {
    stockReservation.findMany.mockResolvedValue([
      { id: 'r-1', itemId: 'it-1', orderId: 'o-1', quantity: 2, status: 'ACTIVE' },
    ]);
    const out = await repo.listReservations('it-1');
    expect(stockReservation.findMany).toHaveBeenCalledWith({
      where: { itemId: 'it-1', status: ReservationStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    expect(out).toEqual([
      { id: 'r-1', itemId: 'it-1', orderId: 'o-1', quantity: 2, status: ReservationStatus.ACTIVE },
    ]);
  });

  it('creates and maps itemType + numeric sellPrice', async () => {
    inventoryItem.create.mockResolvedValue(item);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(inventoryItem.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.itemType).toBe(InventoryItemType.PRODUK);
    expect(out.sellPrice).toBe(5000);
  });

  it('maps a null sellPrice to null', async () => {
    inventoryItem.findUnique.mockResolvedValue({ ...item, sellPrice: null });
    const out = await repo.findById('it-1');
    expect(out?.sellPrice).toBeNull();
    expect(inventoryItem.findUnique).toHaveBeenCalledWith({ where: { id: 'it-1' } });
  });

  it('findById returns null on miss', async () => {
    inventoryItem.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('finds a line by (depot,type,productId)', async () => {
    inventoryItem.findFirst.mockResolvedValue(item);
    await repo.findLine('depot-1', InventoryItemType.PRODUK, 'prod-1');
    expect(inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', itemType: InventoryItemType.PRODUK, productId: 'prod-1' },
    });
    inventoryItem.findFirst.mockResolvedValue(null);
    expect(await repo.findLine('depot-1', InventoryItemType.AIR, null)).toBeNull();
  });

  it('findPrices short-circuits on empty ids without querying', async () => {
    expect(await repo.findPrices('depot-1', [])).toEqual([]);
    expect(inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('findPrices queries PRODUK lines with a sellPrice and maps them', async () => {
    inventoryItem.findMany.mockResolvedValue([{ productId: 'prod-1', sellPrice: 5000 }]);
    const out = await repo.findPrices('depot-1', ['prod-1']);
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: {
        depotId: 'depot-1',
        itemType: InventoryItemType.PRODUK,
        productId: { in: ['prod-1'] },
        sellPrice: { not: null },
      },
      select: { productId: true, sellPrice: true },
    });
    expect(out).toEqual([{ productId: 'prod-1', sellPrice: 5000 }]);
  });

  it('lists for a depot without filters', async () => {
    inventoryItem.findMany.mockResolvedValue([item]);
    const out = await repo.listForDepot('depot-1', {});
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      // hidden:false is not optional — it is what keeps a line whose catalog product was
      // switched off off the operator's list while internal lookups can still settle it.
      where: { depotId: 'depot-1', hidden: false },
      orderBy: [{ itemType: 'asc' }, { label: 'asc' }],
    });
    expect(out).toHaveLength(1);
  });

  it('lists for a depot filtering by itemType and lowStockOnly', async () => {
    // quantity 10, reserved 2 -> available 8 > min 3 : NOT low. Add a low line.
    const low = { ...item, id: 'it-2', quantity: 4, reserved: 2, minimumStock: 3 }; // available 2 <= 3 : low
    inventoryItem.findMany.mockResolvedValue([item, low]);
    const out = await repo.listForDepot('depot-1', {
      itemType: InventoryItemType.PRODUK,
      lowStockOnly: true,
    } as never);
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', hidden: false, itemType: InventoryItemType.PRODUK },
      orderBy: [{ itemType: 'asc' }, { label: 'asc' }],
    });
    expect(out.map((i) => i.id)).toEqual(['it-2']);
  });

  it('asks Postgres for the low-stock predicate instead of filtering rows in JS', async () => {
    const low = { ...item, id: 'it-2', quantity: 4, reserved: 2, minimumStock: 3 };
    $queryRaw.mockResolvedValue([low]);
    const out = await repo.listLowStock();
    // available <= minimumStock is a two-column comparison Prisma cannot express, so the
    // old shape read every line with a minimum set and filtered them here (audit S-13).
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(inventoryItem.findMany).not.toHaveBeenCalled();
    expect(out.map((i) => i.id)).toEqual(['it-2']);
  });

  it('scopes low stock to one depot, or to several in one query', async () => {
    $queryRaw.mockResolvedValue([]);
    await repo.listLowStock('depot-9');
    await repo.listLowStock(['depot-9', 'depot-8']);
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns nothing, and asks nothing, for an empty depot list', async () => {
    $queryRaw.mockClear();
    expect(await repo.listLowStock([])).toEqual([]);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('updates an item', async () => {
    inventoryItem.update.mockResolvedValue(item);
    await repo.update('it-1', { quantity: 20 } as never);
    expect(inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'it-1' },
      data: { quantity: 20 },
    });
  });

  // CA-2-21. The old shape took the finished quantity from the caller and wrote it
  // absolutely, so of two concurrent adjustments the second erased the first. These two
  // pin the replacement: the arithmetic happens inside the UPDATE, and the ledger's
  // before/after are read back off the row the statement returned.
  it('adds the delta inside the UPDATE instead of writing a quantity computed in Node', async () => {
    // Someone else's +3 landed between the caller's read and this write: the row comes
    // back at 18, not at the 15 the caller would have computed from what it read.
    $queryRaw.mockResolvedValue([{ ...item, quantity: 18 }]);
    stockMovement.create.mockResolvedValue({ id: 'mv-1' });
    const movement = {
      itemId: 'it-1',
      type: StockMovementType.RECEIPT,
      delta: 5,
      quantityBefore: 10,
      quantityAfter: 15,
    } as never;
    const out = await repo.applyMovement('it-1', movement);

    expect(inventoryItem.update).not.toHaveBeenCalled();
    const sql = ($queryRaw.mock.calls.at(-1) as unknown[])[0] as { strings: string[] };
    const text = sql.strings.join('?');
    // The SET clause itself must be relative. Asserting on the whole statement is not
    // enough: the floor in the WHERE also reads `"quantity" + `, so an absolute
    // `SET "quantity" = ?` passed that check while reintroducing the whole race.
    expect(text).toMatch(/SET\s+"quantity"\s*=\s*"quantity"\s*\+/);
    expect(text).toContain('>= 0');
    // Not 10 -> 15. The movement records the write that really happened: 13 -> 18.
    expect(stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantityBefore: 13, quantityAfter: 18 }),
    });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(out.quantity).toBe(18);
  });


  /*
   * CA-2-21, and the line the floor must NOT cross.
   *
   * depot-service has always let a SALE take a line negative on purpose: the gallon left
   * the shelf, and refusing to record that does not put it back — it just makes the count
   * disagree with the world and hides the disagreement. Every other movement is somebody
   * typing a number, and those are the ones a concurrent sale can slip underneath.
   */
  it('leaves the floor off a SALE, so reality is still recordable', async () => {
    $queryRaw.mockResolvedValue([{ ...item, quantity: -2 }]);
    stockMovement.create.mockResolvedValue({ id: 'mv-2' });

    await repo.applyMovement('it-1', {
      itemId: 'it-1',
      type: StockMovementType.SALE,
      delta: -12,
      quantityBefore: 10,
      quantityAfter: -2,
    } as never);

    const text = (($queryRaw.mock.calls.at(-1) as unknown[])[0] as { strings: string[] }).strings.join('?');
    expect(text).toMatch(/SET\s+"quantity"\s*=\s*"quantity"\s*\+/);
    expect(text).not.toContain('>= 0');
  });

  it('keeps the floor on a typed adjustment', async () => {
    $queryRaw.mockResolvedValue([{ ...item, quantity: 4 }]);
    stockMovement.create.mockResolvedValue({ id: 'mv-3' });

    await repo.applyMovement('it-1', {
      itemId: 'it-1',
      type: StockMovementType.ADJUSTMENT,
      delta: -6,
      quantityBefore: 10,
      quantityAfter: 4,
    } as never);

    const text = (($queryRaw.mock.calls.at(-1) as unknown[])[0] as { strings: string[] }).strings.join('?');
    expect(text).toContain('>= 0');
  });

  it('refuses the movement, and writes no ledger row, when the floor rejects it', async () => {
    $queryRaw.mockResolvedValue([]);
    await expect(
      repo.applyMovement('it-1', { itemId: 'it-1', type: StockMovementType.SALE, delta: -99 } as never),
    ).rejects.toBeInstanceOf(NegativeStockError);
    expect(stockMovement.create).not.toHaveBeenCalled();
  });

  it('detects an existing movement for an order', async () => {
    stockMovement.findFirst.mockResolvedValue({ id: 'mv-1' });
    expect(await repo.hasMovementForOrder('it-1', 'ord-1')).toBe(true);
    expect(stockMovement.findFirst).toHaveBeenCalledWith({
      where: { itemId: 'it-1', orderId: 'ord-1' },
      select: { id: true },
    });
    stockMovement.findFirst.mockResolvedValue(null);
    expect(await repo.hasMovementForOrder('it-1', 'ord-2')).toBe(false);
  });

  it('lists movements newest-first, mapping the type', async () => {
    stockMovement.findMany.mockResolvedValue([{ id: 'mv-1', type: 'ADJUSTMENT', delta: -1 }]);
    const out = await repo.listMovements('it-1');
    expect(stockMovement.findMany).toHaveBeenCalledWith({
      where: { itemId: 'it-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(out[0].type).toBe(StockMovementType.ADJUSTMENT);
  });

  it('seeks past a movement cursor instead of an offset (stock_movements grows fastest)', async () => {
    stockMovement.findMany.mockResolvedValue([
      {
        id: 'mv-9',
        itemId: 'it-1',
        type: 'SALE',
        delta: -1,
        quantityBefore: 5,
        quantityAfter: 4,
        reason: null,
        actorId: 'staff-1',
        orderId: null,
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        item: { label: 'Galon 19L', itemType: 'GALON' },
      },
    ]);
    stockMovement.count.mockResolvedValue(5000);

    const out = await repo.listForDepotMovements('depot-1', {
      page: 40,
      limit: 1,
      cursor: 'mv-8',
    });

    expect(stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'mv-8' }, skip: 1, take: 1 }),
    );
    expect(out.nextCursor).toBe('mv-9');
  });

  it('lists one page of depot movements with item labels and filters', async () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');
    const where = {
      item: { depotId: 'depot-1' },
      type: StockMovementType.OPNAME,
      createdAt: { gte: from, lt: to },
    };
    stockMovement.findMany.mockResolvedValue([
      {
        id: 'mv-1',
        itemId: 'it-1',
        type: 'OPNAME',
        delta: -2,
        quantityBefore: 10,
        quantityAfter: 8,
        reason: 'Counted',
        actorId: 'staff-1',
        orderId: null,
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        item: { label: 'Galon 19L', itemType: 'GALON' },
      },
    ]);
    stockMovement.count.mockResolvedValue(21);

    const out = await repo.listForDepotMovements('depot-1', {
      type: StockMovementType.OPNAME,
      from,
      to,
      page: 2,
      limit: 20,
    });

    expect(stockMovement.findMany).toHaveBeenCalledWith({
      where,
      select: {
        id: true,
        itemId: true,
        type: true,
        delta: true,
        quantityBefore: true,
        quantityAfter: true,
        reason: true,
        actorId: true,
        orderId: true,
        createdAt: true,
        item: { select: { label: true, itemType: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(stockMovement.count).toHaveBeenCalledWith({ where });
    expect(out).toEqual({
      total: 21,
      nextCursor: null,
      items: [
        expect.objectContaining({
          id: 'mv-1',
          type: StockMovementType.OPNAME,
          itemLabel: 'Galon 19L',
          itemType: InventoryItemType.GALON,
        }),
      ],
    });
  });

  it('gathers opname variances over a range, keeping both signs', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    stockMovement.findMany.mockResolvedValue([
      { delta: -3, item: { sellPrice: 20000 } },
      { delta: 1, item: { sellPrice: null } },
    ]);
    const out = await repo.opnameVariances('depot-1', { from, to });
    expect(stockMovement.findMany).toHaveBeenCalledWith({
      where: {
        type: StockMovementType.OPNAME,
        item: { depotId: 'depot-1' },
        createdAt: { gte: from, lt: to },
      },
      select: { delta: true, item: { select: { sellPrice: true } } },
    });
    expect(out).toEqual([
      { sellPrice: 20000, delta: -3 },
      { sellPrice: null, delta: 1 },
    ]);
  });

  it('asks for opname movements with no range at all when none is given', async () => {
    stockMovement.findMany.mockResolvedValue([]);
    await repo.opnameVariances('depot-1', {});
    expect(stockMovement.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { type: StockMovementType.OPNAME, item: { depotId: 'depot-1' } },
      }),
    );
  });

  it('gathers wastage adjustments over a range, mapping nested item fields', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    stockMovement.findMany.mockResolvedValue([
      { itemId: 'it-1', delta: -2, item: { label: 'Aqua', sellPrice: 5000 } },
      { itemId: 'it-2', delta: -1, item: { label: 'Galon', sellPrice: null } },
    ]);
    const out = await repo.wastageAdjustments('depot-1', { from, to });
    expect(stockMovement.findMany).toHaveBeenCalledWith({
      where: {
        type: StockMovementType.ADJUSTMENT,
        delta: { lt: 0 },
        item: { depotId: 'depot-1' },
        createdAt: { gte: from, lt: to },
      },
      select: { itemId: true, delta: true, item: { select: { label: true, sellPrice: true } } },
    });
    expect(out).toEqual([
      { itemId: 'it-1', label: 'Aqua', sellPrice: 5000, delta: -2 },
      { itemId: 'it-2', label: 'Galon', sellPrice: null, delta: -1 },
    ]);
  });

  it('gathers wastage adjustments with no range (no createdAt filter)', async () => {
    stockMovement.findMany.mockResolvedValue([]);
    await repo.wastageAdjustments('depot-1', {});
    expect(stockMovement.findMany).toHaveBeenCalledWith({
      where: { type: StockMovementType.ADJUSTMENT, delta: { lt: 0 }, item: { depotId: 'depot-1' } },
      select: { itemId: true, delta: true, item: { select: { label: true, sellPrice: true } } },
    });
  });

  it('finds a reservation by composite key, mapping status', async () => {
    stockReservation.findUnique.mockResolvedValue({
      id: 'rs-1',
      itemId: 'it-1',
      orderId: 'ord-1',
      quantity: 2,
      status: 'ACTIVE',
    });
    const out = await repo.findReservation('it-1', 'ord-1');
    expect(stockReservation.findUnique).toHaveBeenCalledWith({
      where: { itemId_orderId: { itemId: 'it-1', orderId: 'ord-1' } },
    });
    expect(out?.status).toBe(ReservationStatus.ACTIVE);
    stockReservation.findUnique.mockResolvedValue(null);
    expect(await repo.findReservation('it-1', 'ord-2')).toBeNull();
  });

  // Audit S-3/S-24: the batch reads that replaced the per-line walk.
  it('reads many lines and prior movements in one query each, and counts by type', async () => {
    inventoryItem.findMany.mockResolvedValue([item]);
    expect(await repo.findLines('depot-1', InventoryItemType.PRODUK, [])).toEqual([]);
    const lines = await repo.findLines('depot-1', InventoryItemType.PRODUK, ['prod-1']);
    expect(lines[0].id).toBe('it-1');
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', itemType: InventoryItemType.PRODUK, productId: { in: ['prod-1'] } },
    });

    expect(await repo.itemsWithMovementForOrder('ord-1', [])).toEqual(new Set());
    stockMovement.findMany.mockResolvedValue([{ itemId: 'it-1' }]);
    expect(await repo.itemsWithMovementForOrder('ord-1', ['it-1', 'it-2'])).toEqual(
      new Set(['it-1']),
    );
    expect(stockMovement.findMany).toHaveBeenLastCalledWith({
      where: { orderId: 'ord-1', itemId: { in: ['it-1', 'it-2'] } },
      select: { itemId: true },
      distinct: ['itemId'],
    });

    stockMovement.count.mockResolvedValue(2);
    expect(await repo.countMovements('it-1', StockMovementType.SALE)).toBe(2);
    expect(stockMovement.count).toHaveBeenCalledWith({
      where: { itemId: 'it-1', type: StockMovementType.SALE },
    });
  });

  it('reserveAtomic short-circuits on empty plans', async () => {
    const out = await repo.reserveAtomic([], 'ord-1');
    expect(out).toEqual({ shortfalls: [] });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('reserveAtomic reports shortfalls and writes nothing', async () => {
    $queryRaw.mockResolvedValue([{ id: 'it-1', quantity: 1, reserved: 1 }]); // available 0
    const out = await repo.reserveAtomic([{ itemId: 'it-1', quantity: 2 }], 'ord-1');
    expect(out).toEqual({ shortfalls: [{ itemId: 'it-1', requested: 2, available: 0 }] });
    expect($executeRaw).not.toHaveBeenCalled();
    expect(stockReservation.createMany).not.toHaveBeenCalled();
  });

  // A line the lock statement did not return does not exist any more — it must read as
  // zero sellable, not as unlimited.
  it('reserveAtomic treats a line that vanished as a shortfall', async () => {
    $queryRaw.mockResolvedValue([]);
    const out = await repo.reserveAtomic([{ itemId: 'gone', quantity: 1 }], 'ord-1');
    expect(out).toEqual({ shortfalls: [{ itemId: 'gone', requested: 1, available: 0 }] });
  });

  // Audit S-4 and its Q-17 baseline row: this used to be a SELECT ... FOR UPDATE, an UPDATE
  // and an INSERT PER LINE — 3N statements with every row locked for the whole walk.
  it('locks every line in one statement', async () => {
    $queryRaw.mockResolvedValue([
      { id: 'a', quantity: 100, reserved: 0 },
      { id: 'b', quantity: 100, reserved: 0 },
    ]);
    stockReservation.createMany.mockResolvedValue({ count: 2 });
    const out = await repo.reserveAtomic(
      [
        { itemId: 'b', quantity: 1 },
        { itemId: 'a', quantity: 2 },
      ],
      'ord-1',
    );
    expect(out).toEqual({ shortfalls: [] });
    // Three statements for two lines, and the count does not move with the line count.
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(stockReservation.createMany).toHaveBeenCalledTimes(1);
    // Deterministic lock order survives: sorted a before b, both in one insert.
    expect(stockReservation.createMany).toHaveBeenCalledWith({
      data: [
        { itemId: 'a', orderId: 'ord-1', quantity: 2 },
        { itemId: 'b', orderId: 'ord-1', quantity: 1 },
      ],
    });
  });

  // B-5: settle used to read the status OUTSIDE the transaction and then update on `id`
  // alone. Two concurrent settles (a staff cancellation racing the abandoned-order sweep,
  // or release racing consume) both saw ACTIVE and both ran the decrement, so `reserved`
  // fell twice for one hold, `available` over-reported, and the depot oversold silently
  // and cumulatively. The claim is now a conditional updateMany on status: ACTIVE — the
  // same discipline reserveAtomic already uses one function above.
  const activeHold = { id: 'rs-1', itemId: 'it-1', orderId: 'ord-1', quantity: 2, status: 'ACTIVE' };

  it('releaseReservation claims the hold conditionally and gives units back once', async () => {
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    stockReservation.findUnique.mockResolvedValue({ ...activeHold, status: 'RELEASED' });
    inventoryItem.update.mockResolvedValue(item);

    await repo.releaseReservation('it-1', 'ord-1');

    expect(stockReservation.updateMany).toHaveBeenCalledWith({
      where: { itemId: 'it-1', orderId: 'ord-1', status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.RELEASED },
    });
    expect(inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'it-1' },
      data: { reserved: { decrement: 2 } },
    });
  });

  it('consumeReservation claims the hold conditionally as CONSUMED', async () => {
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    stockReservation.findUnique.mockResolvedValue({ ...activeHold, status: 'CONSUMED' });
    inventoryItem.update.mockResolvedValue(item);

    await repo.consumeReservation('it-1', 'ord-1');

    expect(stockReservation.updateMany).toHaveBeenCalledWith({
      where: { itemId: 'it-1', orderId: 'ord-1', status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.CONSUMED },
    });
  });

  it('a settle that loses the race decrements nothing — this is the oversell bug', async () => {
    // count: 0 means another transaction already flipped the row out of ACTIVE. The old
    // code reached the decrement anyway, because its guard was a stale read.
    stockReservation.updateMany.mockResolvedValue({ count: 0 });

    await repo.consumeReservation('it-1', 'ord-1');

    expect(inventoryItem.update).not.toHaveBeenCalled();
  });

  it('settling is idempotent for a missing or already-terminal reservation', async () => {
    stockReservation.updateMany.mockResolvedValue({ count: 0 });
    await repo.releaseReservation('it-1', 'ord-1');
    await repo.consumeReservation('it-1', 'ord-1');
    expect(inventoryItem.update).not.toHaveBeenCalled();
  });

  it('does the claim and the give-back in ONE transaction, not two statements', async () => {
    stockReservation.updateMany.mockResolvedValue({ count: 1 });
    stockReservation.findUnique.mockResolvedValue({ ...activeHold, status: 'RELEASED' });
    inventoryItem.update.mockResolvedValue(item);

    await repo.releaseReservation('it-1', 'ord-1');

    // A crash between claim and decrement would otherwise leave the hold terminal with
    // its units still held — stock lost to a ghost reservation.
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

describe('MaintenancePrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { maintenanceItem: model } as unknown as PrismaService;
  const repo = new MaintenancePrismaRepository(prisma);
  const row = {
    id: 'mt-1',
    depotId: 'depot-1',
    name: 'RO filter',
    category: 'FILTER',
    intervalDays: 30,
    lastServicedAt: null,
    nextDueAt: new Date('2026-02-01'),
    status: 'DUE',
    note: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and maps status', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.status).toBe('DUE');
  });

  it('lists for a depot by next-due ascending', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { nextDueAt: 'asc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('mt-1', { status: 'DONE' } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'mt-1' }, data: { status: 'DONE' } });
  });
});

describe('PriceOverrideProposalPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { priceOverrideProposal: model } as unknown as PrismaService;
  const repo = new PriceOverrideProposalPrismaRepository(prisma);
  const row = {
    id: 'po-1',
    depotId: 'depot-1',
    depotName: 'Depot Satu',
    productId: 'prod-1',
    productName: 'Aqua',
    currentPrice: decimal(5000),
    adjustType: 'PERCENT',
    value: decimal(10),
    note: null,
    status: 'PENDING',
    proposedBy: 'op-1',
    decidedBy: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, coercing decimals and mapping enums', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.currentPrice).toBe(5000);
    expect(out.value).toBe(10);
    expect(out.adjustType).toBe('PERCENT');
    expect(out.status).toBe('PENDING');
  });

  it('lists with paging, no status filter', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.list({ page: 1, limit: 20 } as never);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(out.total).toBe(1);
    expect(out.items[0].currentPrice).toBe(5000);
  });

  it('lists filtering by status with paging offset', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.list({ page: 2, limit: 5, status: 'APPROVED' } as never);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 5,
    });
  });

  it('counts by product, optionally filtering by status', async () => {
    model.groupBy.mockResolvedValue([{ productId: 'prod-1', _count: { _all: 3 } }]);
    const out = await repo.countByProduct('PENDING' as never);
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['productId'],
      where: { status: 'PENDING' },
      _count: { _all: true },
    });
    expect(out).toEqual([{ productId: 'prod-1', count: 3 }]);

    await repo.countByProduct();
    expect(model.groupBy).toHaveBeenLastCalledWith({
      by: ['productId'],
      where: {},
      _count: { _all: true },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    model.findUnique.mockResolvedValue(row);
    expect((await repo.findById('po-1'))?.id).toBe('po-1');
  });

  it('updates only provided fields (status + decidedBy)', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('po-1', { status: 'APPROVED', decidedBy: 'boss' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { status: 'APPROVED', decidedBy: 'boss' },
    });

    await repo.update('po-1', {} as never);
    expect(model.update).toHaveBeenLastCalledWith({ where: { id: 'po-1' }, data: {} });
  });
});

describe('PricingRulePrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { pricingRule: model } as unknown as PrismaService;
  const repo = new PricingRulePrismaRepository(prisma);
  const row = {
    id: 'pr-1',
    depotId: 'depot-1',
    productId: null,
    adjustType: 'PERCENT',
    value: decimal(5),
    daysOfWeek: [1, 2, 3],
    startMinute: 480,
    endMinute: 1020,
    validFrom: null,
    validUntil: null,
    priority: 10,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, coercing the decimal value', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.value).toBe(5);
    expect(out.adjustType).toBe('PERCENT');
    expect(out.daysOfWeek).toEqual([1, 2, 3]);
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('lists for a depot by priority then recency', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('lists only active rules for a depot', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listActiveForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1', active: true } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('pr-1', { priority: 20 } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'pr-1' }, data: { priority: 20 } });
  });

  it('deletes by id', async () => {
    model.delete.mockResolvedValue(row);
    await repo.delete('pr-1');
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'pr-1' } });
  });
});

describe('PurchaseOrderPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { purchaseOrder: model } as unknown as PrismaService;
  const repo = new PurchaseOrderPrismaRepository(prisma);
  const row = {
    id: 'po-1',
    depotId: 'depot-1',
    poNumber: 'PO-1',
    supplierId: 'sup-1',
    supplierName: 'PT Air',
    status: 'DRAFT',
    lines: [{ label: 'Galon', qty: 10 }],
    subtotalIdr: 100000,
    shippingIdr: 5000,
    totalIdr: 105000,
    expectedAt: null,
    receivedAt: null,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates, casting lines json and mapping status', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({
      depotId: 'depot-1',
      lines: [{ label: 'Galon', qty: 10 }],
    } as never);
    expect(model.create).toHaveBeenCalledWith({
      data: { depotId: 'depot-1', lines: [{ label: 'Galon', qty: 10 }] },
    });
    expect(out.status).toBe('DRAFT');
    expect(out.lines).toEqual([{ label: 'Galon', qty: 10 }]);
  });

  it('coerces null lines to empty array', async () => {
    model.create.mockResolvedValue({ ...row, lines: null });
    expect((await repo.create({} as never)).lines).toEqual([]);
  });

  it('lists with and without status', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.listForDepot('depot-1', 'RECEIVED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({
      where: { depotId: 'depot-1', status: 'RECEIVED' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('po-1', { status: 'RECEIVED' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { status: 'RECEIVED' },
    });
  });
});

describe('RosterPrismaRepository', () => {
  const model = { findMany: jest.fn(), upsert: jest.fn() };
  const $transaction = jest.fn().mockImplementation((ops) => Promise.all(ops));
  const prisma = { shiftAssignment: model, $transaction } as unknown as PrismaService;
  const repo = new RosterPrismaRepository(prisma);
  const row = {
    id: 's-1',
    depotId: 'depot-1',
    staffId: 'st-1',
    staffName: 'Ana',
    weekStart: '2026-01-05',
    day: 1,
    shift: 'PAGI',
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists a week for a depot, mapping shift kind', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.listForWeek('depot-1', '2026-01-05');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', weekStart: '2026-01-05' },
    });
    expect(out[0].shift).toBe('PAGI');
  });

  it('upserts a single cell on the composite key', async () => {
    model.upsert.mockResolvedValue(row);
    const a = {
      depotId: 'depot-1',
      weekStart: '2026-01-05',
      staffId: 'st-1',
      staffName: 'Ana',
      day: 1,
      shift: 'PAGI',
    } as never;
    await repo.upsertCell(a);
    expect(model.upsert).toHaveBeenCalledWith({
      where: {
        depotId_weekStart_staffId_day: {
          depotId: 'depot-1',
          weekStart: '2026-01-05',
          staffId: 'st-1',
          day: 1,
        },
      },
      create: a,
      update: { shift: 'PAGI', staffName: 'Ana' },
    });
  });

  it('bulk upserts each assignment inside one transaction', async () => {
    model.upsert.mockResolvedValue(row);
    const out = await repo.bulkUpsert([
      {
        depotId: 'depot-1',
        weekStart: '2026-01-05',
        staffId: 'st-1',
        staffName: 'Ana',
        day: 1,
        shift: 'PAGI',
      },
      {
        depotId: 'depot-1',
        weekStart: '2026-01-05',
        staffId: 'st-1',
        staffName: 'Ana',
        day: 2,
        shift: 'SORE',
      },
    ] as never);
    expect(model.upsert).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(out[0].shift).toBe('PAGI');
  });
});

describe('SubscriptionPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { subscription: model } as unknown as PrismaService;
  const repo = new SubscriptionPrismaRepository(prisma);
  const row = {
    id: 'sb-1',
    depotId: 'depot-1',
    customerId: null,
    customerName: 'Budi',
    productLabel: 'Galon 19L',
    quantity: 2,
    cadence: 'WEEKLY',
    status: 'ACTIVE',
    nextRunAt: null,
    note: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and maps cadence/status', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({ depotId: 'depot-1' } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
    expect(out.cadence).toBe('WEEKLY');
    expect(out.status).toBe('ACTIVE');
  });

  it('lists with and without status', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.listForDepot('depot-1', 'PAUSED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({
      where: { depotId: 'depot-1', status: 'PAUSED' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('sb-1', { status: 'PAUSED' } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'sb-1' },
      data: { status: 'PAUSED' },
    });
  });
});

describe('SupplierPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() };
  const prisma = { supplier: model } as unknown as PrismaService;
  const repo = new SupplierPrismaRepository(prisma);
  const row = { id: 'sup-1', depotId: 'depot-1', code: 'SUP1', name: 'PT Air' };

  beforeEach(() => jest.clearAllMocks());

  it('creates and returns the row', async () => {
    model.create.mockResolvedValue(row);
    expect(await repo.create({ depotId: 'depot-1' } as never)).toBe(row);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
  });

  it('lists for a depot newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    expect(await repo.listForDepot('depot-1')).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds by id', async () => {
    model.findUnique.mockResolvedValue(row);
    expect(await repo.findById('sup-1')).toBe(row);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'sup-1' } });
  });

  it('finds by composite depotId_code key', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByCode('depot-1', 'SUP1')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { depotId_code: { depotId: 'depot-1', code: 'SUP1' } },
    });
  });
});

describe('WholesaleTierPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { wholesaleTier: model } as unknown as PrismaService;
  const repo = new WholesaleTierPrismaRepository(prisma);
  const row = { id: 'wt-1', depotId: 'depot-1', minQty: 10, unitPriceIdr: 4500 };

  beforeEach(() => jest.clearAllMocks());

  it('creates and returns the row', async () => {
    model.create.mockResolvedValue(row);
    expect(await repo.create({ depotId: 'depot-1' } as never)).toBe(row);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
  });

  it('lists for a depot ordered by minQty ascending', async () => {
    model.findMany.mockResolvedValue([row]);
    expect(await repo.listForDepot('depot-1')).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { minQty: 'asc' },
    });
  });

  it('finds by id', async () => {
    model.findUnique.mockResolvedValue(row);
    expect(await repo.findById('wt-1')).toBe(row);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'wt-1' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('wt-1', { unitPriceIdr: 4000 } as never);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'wt-1' },
      data: { unitPriceIdr: 4000 },
    });
  });

  it('deletes by id', async () => {
    model.delete.mockResolvedValue(row);
    await repo.delete('wt-1');
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'wt-1' } });
  });
});
