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
import { InventoryItemType, ReservationStatus, StockMovementType } from '../../src/domain/inventory';
import { GallonCondition } from '../../src/domain/gallon-return';

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
  };
  const prisma = { approval: model } as unknown as PrismaService;
  const repo = new ApprovalPrismaRepository(prisma);
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
    const data = { depotId: 'depot-1', type: ApprovalType.OPNAME_VARIANCE, payload: { variance: -3 } } as never;
    const out = await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1', type: ApprovalType.OPNAME_VARIANCE, payload: { variance: -3 } } });
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
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
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'ap-1' }, data: { status: ApprovalStatus.APPROVED } });
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
    expect(out).toEqual({ OPNAME_VARIANCE: 2, DEPOSIT_REFUND: 0, COD_VARIANCE: 5 });
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { occurredAt: 'desc' } });
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
    expect(model.findUnique).toHaveBeenCalledWith({ where: { depotId_month: { depotId: 'depot-1', month: '2026-01' } } });
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

  it('searches with paging and no filters, mapping decimals/json', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.search({ page: 2, limit: 10 } as never);
    expect(model.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { code: 'asc' }, skip: 10, take: 10 });
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
    await repo.search({ page: 1, limit: 5, activeOnly: true, ownershipType: 'HKP', search: 'sat' } as never);
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { ownerId: 'own-1' }, orderBy: { code: 'asc' } });
  });

  it('creates, casting operatingHours/holidays json', async () => {
    model.create.mockResolvedValue(row);
    const data = { code: 'DPT002', operatingHours: { mon: '09-18' }, holidays: [] } as never;
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data: { code: 'DPT002', operatingHours: { mon: '09-18' }, holidays: [] } });
  });

  it('updates, only including json fields that are provided', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('depot-1', { name: 'Renamed' } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'depot-1' }, data: { name: 'Renamed' } });

    await repo.update('depot-1', { name: 'R2', operatingHours: { mon: '10-19' }, holidays: [{ date: 'x' }] } as never);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { id: 'depot-1' },
      data: { name: 'R2', operatingHours: { mon: '10-19' }, holidays: [{ date: 'x' }] },
    });
  });
});

describe('DisputePrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
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
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'dp-1' }, data: { status: 'RESOLVED' } });
  });
});

describe('FranchiseApplicationPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    expect(model.create).toHaveBeenCalledWith({ data: { applicantName: 'Budi', checklist: { legal: true } } });
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
    expect(model.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { submittedAt: 'asc' }, skip: 0, take: 20 });
    expect(model.count).toHaveBeenCalledWith({ where: {} });
    expect(out.total).toBe(1);
  });

  it('lists filtering by stage with paging offset', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.list({ page: 3, limit: 10, stage: 'REVIEW' } as never);
    expect(model.findMany).toHaveBeenCalledWith({ where: { stage: 'REVIEW' }, orderBy: { submittedAt: 'asc' }, skip: 20, take: 10 });
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
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'fa-1' }, data: { stage: 'APPROVED' } });

    await repo.update('fa-1', { checklist: { legal: false } } as never);
    expect(model.update).toHaveBeenLastCalledWith({ where: { id: 'fa-1' }, data: { checklist: { legal: false } } });
  });
});

describe('GallonIssuePrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() };
  const prisma = { gallonIssue: model } as unknown as PrismaService;
  const repo = new GallonIssuePrismaRepository(prisma);
  const row = { id: 'gi-1', depotId: 'depot-1', quantity: 5, depositHeld: 100000 };

  beforeEach(() => jest.clearAllMocks());

  it('creates and returns the row unchanged', async () => {
    model.create.mockResolvedValue(row);
    expect(await repo.create({ depotId: 'depot-1' } as never)).toBe(row);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1' } });
  });

  it('lists with paging plus total', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const out = await repo.listForDepot('depot-1', 2, 10);
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' }, skip: 10, take: 10 });
    expect(model.count).toHaveBeenCalledWith({ where: { depotId: 'depot-1' } });
    expect(out).toEqual({ items: [row], total: 1 });
  });

  it('summarises a depot, defaulting null sums to zero', async () => {
    model.aggregate.mockResolvedValue({ _count: { _all: 3 }, _sum: { quantity: 12, depositHeld: null } });
    const out = await repo.summaryForDepot('depot-1');
    expect(model.aggregate).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      _count: { _all: true },
      _sum: { quantity: true, depositHeld: true },
    });
    expect(out).toEqual({ issues: 3, gallons: 12, depositHeld: 0 });
  });

  it('rolls up a network summary per depot', async () => {
    model.groupBy.mockResolvedValue([{ depotId: 'depot-1', _sum: { quantity: 5, depositHeld: 100000 } }]);
    const out = await repo.networkSummary();
    expect(model.groupBy).toHaveBeenCalledWith({ by: ['depotId'], _sum: { quantity: true, depositHeld: true } });
    expect(out).toEqual([{ depotId: 'depot-1', gallons: 5, depositHeld: 100000 }]);
  });
});

describe('GallonReturnPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() };
  const prisma = { gallonReturn: model } as unknown as PrismaService;
  const repo = new GallonReturnPrismaRepository(prisma);
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' }, skip: 0, take: 5 });
    expect(out.total).toBe(1);
    expect(out.items[0].depositRefunded).toBe(80000);
  });

  it('summarises with a separate damaged count, coercing refund decimal', async () => {
    model.aggregate.mockResolvedValue({ _count: { _all: 2 }, _sum: { quantity: 6, depositRefunded: decimal(120000) } });
    model.count.mockResolvedValue(1);
    const out = await repo.summaryForDepot('depot-1');
    expect(model.count).toHaveBeenCalledWith({ where: { depotId: 'depot-1', condition: GallonCondition.DAMAGED } });
    expect(out).toEqual({ returns: 2, gallons: 6, damaged: 1, depositRefunded: 120000 });
  });

  it('summarises defaulting a null refund sum to zero', async () => {
    model.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { quantity: null, depositRefunded: null } });
    model.count.mockResolvedValue(0);
    const out = await repo.summaryForDepot('depot-1');
    expect(out).toEqual({ returns: 0, gallons: 0, damaged: 0, depositRefunded: 0 });
  });

  it('rolls up a network summary per depot', async () => {
    model.groupBy.mockResolvedValue([{ depotId: 'depot-1', _sum: { quantity: 4, depositRefunded: decimal(80000) } }]);
    const out = await repo.networkSummary();
    expect(model.groupBy).toHaveBeenCalledWith({ by: ['depotId'], _sum: { quantity: true, depositRefunded: true } });
    expect(out).toEqual([{ depotId: 'depot-1', gallons: 4, depositRefunded: 80000 }]);
  });
});

describe('HandoverPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    const out = await repo.create({ depotId: 'depot-1', items: [{ label: 'kas', value: '100000' }] } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1', items: [{ label: 'kas', value: '100000' }] } });
    expect(out.items).toEqual([{ label: 'kas', value: '100000' }]);
  });

  it('coerces null items to empty array', async () => {
    model.create.mockResolvedValue({ ...row, items: null });
    expect((await repo.create({} as never)).items).toEqual([]);
  });

  it('lists for a depot newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
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
      update: { attendance: '5/6', recordedBy: 'op-1', agenda: [{ topic: 't' }], actionItems: [{ task: 'a' }] },
    });
    expect(out.agenda).toEqual([{ topic: 't' }]);
    expect(out.actionItems).toEqual([{ task: 'a' }]);
  });

  it('finds a week, null on miss and coercing null json', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findForWeek('depot-1', '2026-01-05')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { depotId_weekStart: { depotId: 'depot-1', weekStart: '2026-01-05' } } });

    model.findUnique.mockResolvedValue({ ...row, agenda: null, actionItems: null });
    const out = await repo.findForWeek('depot-1', '2026-01-05');
    expect(out?.agenda).toEqual([]);
    expect(out?.actionItems).toEqual([]);
  });

  it('lists for a depot newest-week-first', async () => {
    model.findMany.mockResolvedValue([row]);
    await repo.listForDepot('depot-1');
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { weekStart: 'desc' } });
  });
});

describe('IncidentPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
    await repo.listForDepot('depot-1', 'RESOLVED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({ where: { depotId: 'depot-1', status: 'RESOLVED' }, orderBy: { createdAt: 'desc' } });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('in-1', { status: 'RESOLVED' } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'in-1' }, data: { status: 'RESOLVED' } });
  });
});

describe('InventoryPrismaRepository', () => {
  const inventoryItem = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const stockMovement = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const stockReservation = { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() };
  const $queryRaw = jest.fn();
  // Support both array-form ($transaction([...]) -> Promise.all) and interactive callback form.
  const $transaction = jest.fn().mockImplementation((arg) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  const prisma = {
    inventoryItem,
    stockMovement,
    stockReservation,
    $queryRaw,
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
    expect(inventoryItem.findFirst).toHaveBeenCalledWith({ where: { depotId: 'depot-1', itemType: InventoryItemType.PRODUK, productId: 'prod-1' } });
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
      where: { depotId: 'depot-1', itemType: InventoryItemType.PRODUK, productId: { in: ['prod-1'] }, sellPrice: { not: null } },
      select: { productId: true, sellPrice: true },
    });
    expect(out).toEqual([{ productId: 'prod-1', sellPrice: 5000 }]);
  });

  it('lists for a depot without filters', async () => {
    inventoryItem.findMany.mockResolvedValue([item]);
    const out = await repo.listForDepot('depot-1', {});
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: [{ itemType: 'asc' }, { label: 'asc' }],
    });
    expect(out).toHaveLength(1);
  });

  it('lists for a depot filtering by itemType and lowStockOnly', async () => {
    // quantity 10, reserved 2 -> available 8 > min 3 : NOT low. Add a low line.
    const low = { ...item, id: 'it-2', quantity: 4, reserved: 2, minimumStock: 3 }; // available 2 <= 3 : low
    inventoryItem.findMany.mockResolvedValue([item, low]);
    const out = await repo.listForDepot('depot-1', { itemType: InventoryItemType.PRODUK, lowStockOnly: true } as never);
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', itemType: InventoryItemType.PRODUK },
      orderBy: [{ itemType: 'asc' }, { label: 'asc' }],
    });
    expect(out.map((i) => i.id)).toEqual(['it-2']);
  });

  it('lists low stock across the network, filtering by available<=min', async () => {
    const low = { ...item, id: 'it-2', quantity: 4, reserved: 2, minimumStock: 3 };
    inventoryItem.findMany.mockResolvedValue([item, low]);
    const out = await repo.listLowStock();
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: { minimumStock: { gt: 0 } },
      orderBy: [{ depotId: 'asc' }, { itemType: 'asc' }],
    });
    expect(out.map((i) => i.id)).toEqual(['it-2']);
  });

  it('lists low stock scoped to one depot', async () => {
    inventoryItem.findMany.mockResolvedValue([]);
    await repo.listLowStock('depot-9');
    expect(inventoryItem.findMany).toHaveBeenCalledWith({
      where: { minimumStock: { gt: 0 }, depotId: 'depot-9' },
      orderBy: [{ depotId: 'asc' }, { itemType: 'asc' }],
    });
  });

  it('updates an item', async () => {
    inventoryItem.update.mockResolvedValue(item);
    await repo.update('it-1', { quantity: 20 } as never);
    expect(inventoryItem.update).toHaveBeenCalledWith({ where: { id: 'it-1' }, data: { quantity: 20 } });
  });

  it('applies a movement atomically (item update + movement create in one txn)', async () => {
    inventoryItem.update.mockResolvedValue(item);
    stockMovement.create.mockResolvedValue({ id: 'mv-1' });
    const movement = { type: StockMovementType.RECEIPT, delta: 5 } as never;
    const out = await repo.applyMovement('it-1', 15, movement);
    expect(inventoryItem.update).toHaveBeenCalledWith({ where: { id: 'it-1' }, data: { quantity: 15 } });
    expect(stockMovement.create).toHaveBeenCalledWith({ data: movement });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(out.id).toBe('it-1');
  });

  it('detects an existing movement for an order', async () => {
    stockMovement.findFirst.mockResolvedValue({ id: 'mv-1' });
    expect(await repo.hasMovementForOrder('it-1', 'ord-1')).toBe(true);
    expect(stockMovement.findFirst).toHaveBeenCalledWith({ where: { itemId: 'it-1', orderId: 'ord-1' }, select: { id: true } });
    stockMovement.findFirst.mockResolvedValue(null);
    expect(await repo.hasMovementForOrder('it-1', 'ord-2')).toBe(false);
  });

  it('lists movements newest-first, mapping the type', async () => {
    stockMovement.findMany.mockResolvedValue([{ id: 'mv-1', type: 'ADJUSTMENT', delta: -1 }]);
    const out = await repo.listMovements('it-1');
    expect(stockMovement.findMany).toHaveBeenCalledWith({ where: { itemId: 'it-1' }, orderBy: { createdAt: 'desc' } });
    expect(out[0].type).toBe(StockMovementType.ADJUSTMENT);
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
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 20,
    });
    expect(stockMovement.count).toHaveBeenCalledWith({ where });
    expect(out).toEqual({
      total: 21,
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
    stockReservation.findUnique.mockResolvedValue({ id: 'rs-1', itemId: 'it-1', orderId: 'ord-1', quantity: 2, status: 'ACTIVE' });
    const out = await repo.findReservation('it-1', 'ord-1');
    expect(stockReservation.findUnique).toHaveBeenCalledWith({ where: { itemId_orderId: { itemId: 'it-1', orderId: 'ord-1' } } });
    expect(out?.status).toBe(ReservationStatus.ACTIVE);
    stockReservation.findUnique.mockResolvedValue(null);
    expect(await repo.findReservation('it-1', 'ord-2')).toBeNull();
  });

  it('reserveAtomic short-circuits on empty plans', async () => {
    const out = await repo.reserveAtomic([], 'ord-1');
    expect(out).toEqual({ shortfalls: [] });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('reserveAtomic reports shortfalls and writes nothing', async () => {
    $queryRaw.mockResolvedValue([{ quantity: 1, reserved: 1 }]); // available 0
    const out = await repo.reserveAtomic([{ itemId: 'it-1', quantity: 2 }], 'ord-1');
    expect(out).toEqual({ shortfalls: [{ itemId: 'it-1', requested: 2, available: 0 }] });
    expect(inventoryItem.update).not.toHaveBeenCalled();
    expect(stockReservation.create).not.toHaveBeenCalled();
  });

  it('reserveAtomic increments reserved and creates rows when stock suffices', async () => {
    $queryRaw.mockResolvedValue([{ quantity: 100, reserved: 0 }]);
    inventoryItem.update.mockResolvedValue(item);
    stockReservation.create.mockResolvedValue({ id: 'rs-1' });
    const out = await repo.reserveAtomic(
      [
        { itemId: 'b', quantity: 1 },
        { itemId: 'a', quantity: 2 },
      ],
      'ord-1',
    );
    expect(out).toEqual({ shortfalls: [] });
    // Deterministic lock order: sorted a before b.
    expect(inventoryItem.update).toHaveBeenNthCalledWith(1, { where: { id: 'a' }, data: { reserved: { increment: 2 } } });
    expect(inventoryItem.update).toHaveBeenNthCalledWith(2, { where: { id: 'b' }, data: { reserved: { increment: 1 } } });
    expect(stockReservation.create).toHaveBeenCalledWith({ data: { itemId: 'a', orderId: 'ord-1', quantity: 2 } });
    expect(stockReservation.create).toHaveBeenCalledWith({ data: { itemId: 'b', orderId: 'ord-1', quantity: 1 } });
  });

  it('releaseReservation flips an ACTIVE hold to RELEASED and gives units back', async () => {
    stockReservation.findUnique.mockResolvedValue({ id: 'rs-1', itemId: 'it-1', orderId: 'ord-1', quantity: 2, status: 'ACTIVE' });
    stockReservation.update.mockResolvedValue({});
    inventoryItem.update.mockResolvedValue(item);
    await repo.releaseReservation('it-1', 'ord-1');
    expect(stockReservation.update).toHaveBeenCalledWith({ where: { id: 'rs-1' }, data: { status: ReservationStatus.RELEASED } });
    expect(inventoryItem.update).toHaveBeenCalledWith({ where: { id: 'it-1' }, data: { reserved: { decrement: 2 } } });
  });

  it('consumeReservation flips an ACTIVE hold to CONSUMED', async () => {
    stockReservation.findUnique.mockResolvedValue({ id: 'rs-1', itemId: 'it-1', orderId: 'ord-1', quantity: 2, status: 'ACTIVE' });
    stockReservation.update.mockResolvedValue({});
    inventoryItem.update.mockResolvedValue(item);
    await repo.consumeReservation('it-1', 'ord-1');
    expect(stockReservation.update).toHaveBeenCalledWith({ where: { id: 'rs-1' }, data: { status: ReservationStatus.CONSUMED } });
  });

  it('settling is idempotent: no txn for a missing or already-terminal reservation', async () => {
    stockReservation.findUnique.mockResolvedValue(null);
    await repo.releaseReservation('it-1', 'ord-1');
    stockReservation.findUnique.mockResolvedValue({ id: 'rs-1', itemId: 'it-1', orderId: 'ord-1', quantity: 2, status: 'RELEASED' });
    await repo.consumeReservation('it-1', 'ord-1');
    expect(stockReservation.update).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('MaintenancePrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { nextDueAt: 'asc' } });
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
  const model = { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 });
    expect(out.total).toBe(1);
    expect(out.items[0].currentPrice).toBe(5000);
  });

  it('lists filtering by status with paging offset', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.list({ page: 2, limit: 5, status: 'APPROVED' } as never);
    expect(model.findMany).toHaveBeenCalledWith({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, skip: 5, take: 5 });
  });

  it('counts by product, optionally filtering by status', async () => {
    model.groupBy.mockResolvedValue([{ productId: 'prod-1', _count: { _all: 3 } }]);
    const out = await repo.countByProduct('PENDING' as never);
    expect(model.groupBy).toHaveBeenCalledWith({ by: ['productId'], where: { status: 'PENDING' }, _count: { _all: true } });
    expect(out).toEqual([{ productId: 'prod-1', count: 3 }]);

    await repo.countByProduct();
    expect(model.groupBy).toHaveBeenLastCalledWith({ by: ['productId'], where: {}, _count: { _all: true } });
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
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'APPROVED', decidedBy: 'boss' } });

    await repo.update('po-1', {} as never);
    expect(model.update).toHaveBeenLastCalledWith({ where: { id: 'po-1' }, data: {} });
  });
});

describe('PricingRulePrismaRepository', () => {
  const model = { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
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
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    const out = await repo.create({ depotId: 'depot-1', lines: [{ label: 'Galon', qty: 10 }] } as never);
    expect(model.create).toHaveBeenCalledWith({ data: { depotId: 'depot-1', lines: [{ label: 'Galon', qty: 10 }] } });
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
    await repo.listForDepot('depot-1', 'RECEIVED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({ where: { depotId: 'depot-1', status: 'RECEIVED' }, orderBy: { createdAt: 'desc' } });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('po-1', { status: 'RECEIVED' } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'po-1' }, data: { status: 'RECEIVED' } });
  });
});

describe('RosterPrismaRepository', () => {
  const model = { findMany: jest.fn(), upsert: jest.fn() };
  const $transaction = jest.fn().mockImplementation((ops) => Promise.all(ops));
  const prisma = { shiftAssignment: model, $transaction } as unknown as PrismaService;
  const repo = new RosterPrismaRepository(prisma);
  const row = { id: 's-1', depotId: 'depot-1', staffId: 'st-1', staffName: 'Ana', weekStart: '2026-01-05', day: 1, shift: 'PAGI' };

  beforeEach(() => jest.clearAllMocks());

  it('lists a week for a depot, mapping shift kind', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.listForWeek('depot-1', '2026-01-05');
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1', weekStart: '2026-01-05' } });
    expect(out[0].shift).toBe('PAGI');
  });

  it('upserts a single cell on the composite key', async () => {
    model.upsert.mockResolvedValue(row);
    const a = { depotId: 'depot-1', weekStart: '2026-01-05', staffId: 'st-1', staffName: 'Ana', day: 1, shift: 'PAGI' } as never;
    await repo.upsertCell(a);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { depotId_weekStart_staffId_day: { depotId: 'depot-1', weekStart: '2026-01-05', staffId: 'st-1', day: 1 } },
      create: a,
      update: { shift: 'PAGI', staffName: 'Ana' },
    });
  });

  it('bulk upserts each assignment inside one transaction', async () => {
    model.upsert.mockResolvedValue(row);
    const out = await repo.bulkUpsert([
      { depotId: 'depot-1', weekStart: '2026-01-05', staffId: 'st-1', staffName: 'Ana', day: 1, shift: 'PAGI' },
      { depotId: 'depot-1', weekStart: '2026-01-05', staffId: 'st-1', staffName: 'Ana', day: 2, shift: 'SORE' },
    ] as never);
    expect(model.upsert).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(out[0].shift).toBe('PAGI');
  });
});

describe('SubscriptionPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
    await repo.listForDepot('depot-1', 'PAUSED' as never);
    expect(model.findMany).toHaveBeenLastCalledWith({ where: { depotId: 'depot-1', status: 'PAUSED' }, orderBy: { createdAt: 'desc' } });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('x')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('sb-1', { status: 'PAUSED' } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'sb-1' }, data: { status: 'PAUSED' } });
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { createdAt: 'desc' } });
  });

  it('finds by id', async () => {
    model.findUnique.mockResolvedValue(row);
    expect(await repo.findById('sup-1')).toBe(row);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'sup-1' } });
  });

  it('finds by composite depotId_code key', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByCode('depot-1', 'SUP1')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { depotId_code: { depotId: 'depot-1', code: 'SUP1' } } });
  });
});

describe('WholesaleTierPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() };
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
    expect(model.findMany).toHaveBeenCalledWith({ where: { depotId: 'depot-1' }, orderBy: { minQty: 'asc' } });
  });

  it('finds by id', async () => {
    model.findUnique.mockResolvedValue(row);
    expect(await repo.findById('wt-1')).toBe(row);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'wt-1' } });
  });

  it('updates by id', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('wt-1', { unitPriceIdr: 4000 } as never);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'wt-1' }, data: { unitPriceIdr: 4000 } });
  });

  it('deletes by id', async () => {
    model.delete.mockResolvedValue(row);
    await repo.delete('wt-1');
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'wt-1' } });
  });
});
