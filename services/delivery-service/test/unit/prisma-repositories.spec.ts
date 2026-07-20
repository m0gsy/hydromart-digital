import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { DeliveryPrismaRepository } from '../../src/infrastructure/prisma/delivery.prisma.repository';
import { IncidentPrismaRepository } from '../../src/infrastructure/prisma/incident.prisma.repository';
import { SettlementPrismaRepository } from '../../src/infrastructure/prisma/settlement.prisma.repository';
import { ShiftPrismaRepository } from '../../src/infrastructure/prisma/shift.prisma.repository';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { ContactMethod } from '../../src/domain/no-show';
import { IncidentCategory, IncidentSeverity } from '../../src/domain/incident';
import { SettlementStatus } from '../../src/domain/settlement';
import { ShiftStatus } from '../../src/domain/shift';

describe('DeliveryPrismaRepository', () => {
  const delivery = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    update: jest.fn(),
  };
  const contactAttempt = { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() };
  const proofOfDelivery = { deleteMany: jest.fn() };
  const $queryRaw = jest.fn();
  const prisma = { delivery, contactAttempt, proofOfDelivery, $queryRaw } as unknown as PrismaService;
  const repo = new DeliveryPrismaRepository(prisma);

  const proofRow = {
    photoUrl: 'p.jpg',
    signatureUrl: 's.png',
    recipientName: 'Budi',
    latitude: -6.2,
    longitude: 106.8,
    note: 'left at gate',
    capturedAt: new Date('2026-02-01'),
  };
  const historyRow = {
    status: 'ASSIGNED',
    changedBy: 'disp-1',
    note: null,
    createdAt: new Date('2026-01-01'),
  };
  const deliveryRow = (over: Record<string, unknown> = {}) => ({
    id: 'del-1',
    orderId: 'ord-1',
    orderNumber: 'HM-0001',
    driverId: 'drv-1',
    depotId: 'dep-1',
    status: 'ASSIGNED',
    destinationAddress: 'Jl. Merdeka 1',
    destinationLat: -6.2,
    destinationLng: 106.8,
    lastLat: null,
    lastLng: null,
    lastLocationAt: null,
    assignedAt: new Date('2026-01-01T08:00:00Z'),
    pickedUpAt: null,
    startedAt: null,
    deliveredAt: null,
    failedAt: null,
    failureReason: null,
    rescheduledFor: null,
    rescheduleSlot: null,
    rescheduleNote: null,
    proof: null,
    history: [historyRow],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('create passes ASSIGNED status + seed history and maps the row', async () => {
    delivery.create.mockResolvedValue(deliveryRow({ proof: proofRow }));
    const rec = await repo.create({
      orderId: 'ord-1',
      orderNumber: 'HM-0001',
      driverId: 'drv-1',
      depotId: 'dep-1',
      destinationAddress: 'Jl. Merdeka 1',
      destinationLat: -6.2,
      destinationLng: 106.8,
    } as never);
    expect(delivery.create).toHaveBeenCalledWith({
      data: {
        orderId: 'ord-1',
        orderNumber: 'HM-0001',
        driverId: 'drv-1',
        depotId: 'dep-1',
        destinationAddress: 'Jl. Merdeka 1',
        destinationLat: -6.2,
        destinationLng: 106.8,
        status: DeliveryStatus.ASSIGNED,
        items: expect.anything(),
        history: { create: { status: DeliveryStatus.ASSIGNED } },
      },
      include: { proof: true, history: { orderBy: { createdAt: 'asc' } } },
    });
    expect(rec.id).toBe('del-1');
    expect(rec.status).toBe(DeliveryStatus.ASSIGNED);
    expect(rec.proof?.recipientName).toBe('Budi');
    expect(rec.history[0].status).toBe(DeliveryStatus.ASSIGNED);
  });

  it('findById maps a row and returns null when absent', async () => {
    delivery.findUnique.mockResolvedValueOnce(deliveryRow());
    const found = await repo.findById('del-1');
    expect(found?.id).toBe('del-1');
    expect(found?.proof).toBeNull();
    expect(delivery.findUnique).toHaveBeenCalledWith({
      where: { id: 'del-1' },
      include: { proof: true, history: { orderBy: { createdAt: 'asc' } } },
    });
    delivery.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('findByOrder queries by orderId and returns null when absent', async () => {
    delivery.findUnique.mockResolvedValueOnce(deliveryRow());
    expect((await repo.findByOrder('ord-1'))?.orderId).toBe('ord-1');
    expect(delivery.findUnique).toHaveBeenCalledWith({
      where: { orderId: 'ord-1' },
      include: { proof: true, history: { orderBy: { createdAt: 'asc' } } },
    });
    delivery.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByOrder('nope')).toBeNull();
  });

  it('countActiveByDriver filters to active statuses', async () => {
    delivery.count.mockResolvedValue(3);
    expect(await repo.countActiveByDriver('drv-1')).toBe(3);
    expect(delivery.count).toHaveBeenCalledWith({
      where: {
        driverId: 'drv-1',
        status: {
          in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.ON_DELIVERY],
        },
      },
    });
  });

  it('recordContactAttempt persists then returns contact state', async () => {
    contactAttempt.create.mockResolvedValue({});
    contactAttempt.count.mockResolvedValue(2);
    const at = new Date('2026-01-01T09:00:00Z');
    contactAttempt.findFirst.mockResolvedValue({ createdAt: at });
    const state = await repo.recordContactAttempt('del-1', 'drv-1', ContactMethod.CALL, 'no answer');
    expect(contactAttempt.create).toHaveBeenCalledWith({
      data: { deliveryId: 'del-1', driverId: 'drv-1', method: ContactMethod.CALL, note: 'no answer' },
    });
    expect(state).toEqual({ attempts: 2, firstAttemptAt: at });
  });

  it('contactState returns nulled firstAttemptAt when there are no attempts', async () => {
    contactAttempt.count.mockResolvedValue(0);
    contactAttempt.findFirst.mockResolvedValue(null);
    const state = await repo.contactState('del-1');
    expect(state).toEqual({ attempts: 0, firstAttemptAt: null });
    expect(contactAttempt.findFirst).toHaveBeenCalledWith({
      where: { deliveryId: 'del-1' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
  });

  it('search builds a full where clause with paging and returns items + total', async () => {
    delivery.findMany.mockResolvedValue([deliveryRow()]);
    delivery.count.mockResolvedValue(1);
    const res = await repo.search({
      driverId: 'drv-1',
      depotId: 'dep-1',
      status: DeliveryStatus.ASSIGNED,
      page: 2,
      limit: 10,
    } as never);
    expect(res).toEqual({ items: [expect.objectContaining({ id: 'del-1' })], total: 1 });
    expect(delivery.findMany).toHaveBeenCalledWith({
      where: { driverId: 'drv-1', depotId: 'dep-1', status: DeliveryStatus.ASSIGNED },
      include: { proof: true, history: { orderBy: { createdAt: 'asc' } } },
      orderBy: { assignedAt: 'desc' },
      skip: 10,
      take: 10,
    });
  });

  it('search omits absent filters', async () => {
    delivery.findMany.mockResolvedValue([]);
    delivery.count.mockResolvedValue(0);
    const res = await repo.search({ page: 1, limit: 20 } as never);
    expect(res).toEqual({ items: [], total: 0 });
    expect(delivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 20 }),
    );
  });

  it('deliveredOrderIdsInWindow maps to order ids', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    delivery.findMany.mockResolvedValue([{ orderId: 'ord-1' }, { orderId: 'ord-2' }]);
    expect(await repo.deliveredOrderIdsInWindow('drv-1', from, to)).toEqual(['ord-1', 'ord-2']);
    expect(delivery.findMany).toHaveBeenCalledWith({
      where: { driverId: 'drv-1', status: DeliveryStatus.DELIVERED, deliveredAt: { gte: from, lte: to } },
      select: { orderId: true },
    });
  });

  it('driverDeliveredInWindow maps rows and unwraps deliveredAt', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const assignedAt = new Date('2026-01-02T08:00:00Z');
    const deliveredAt = new Date('2026-01-02T08:20:00Z');
    delivery.findMany.mockResolvedValue([{ orderId: 'ord-1', assignedAt, deliveredAt }]);
    expect(await repo.driverDeliveredInWindow('drv-1', from, to)).toEqual([
      { orderId: 'ord-1', assignedAt, deliveredAt },
    ]);
    expect(delivery.findMany).toHaveBeenCalledWith({
      where: { driverId: 'drv-1', status: DeliveryStatus.DELIVERED, deliveredAt: { gte: from, lt: to } },
      select: { orderId: true, assignedAt: true, deliveredAt: true },
    });
  });

  it('driverFailedCountInWindow counts failures in the window', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    delivery.count.mockResolvedValue(4);
    expect(await repo.driverFailedCountInWindow('drv-1', from, to)).toBe(4);
    expect(delivery.count).toHaveBeenCalledWith({
      where: { driverId: 'drv-1', failedAt: { gte: from, lt: to } },
    });
  });

  it('depotDeliveredCountsInWindow maps grouped counts', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    delivery.groupBy.mockResolvedValue([
      { driverId: 'drv-1', _count: { _all: 5 } },
      { driverId: 'drv-2', _count: { _all: 2 } },
    ]);
    expect(await repo.depotDeliveredCountsInWindow('dep-1', from, to)).toEqual([
      { driverId: 'drv-1', count: 5 },
      { driverId: 'drv-2', count: 2 },
    ]);
    expect(delivery.groupBy).toHaveBeenCalledWith({
      by: ['driverId'],
      where: { depotId: 'dep-1', status: DeliveryStatus.DELIVERED, deliveredAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
  });

  it('updateLocation stamps the coordinates and time', async () => {
    delivery.update.mockResolvedValue(deliveryRow({ lastLat: -6.3, lastLng: 106.9 }));
    const rec = await repo.updateLocation('del-1', -6.3, 106.9);
    expect(rec.lastLat).toBe(-6.3);
    const call = delivery.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'del-1' });
    expect(call.data.lastLat).toBe(-6.3);
    expect(call.data.lastLng).toBe(106.9);
    expect(call.data.lastLocationAt).toBeInstanceOf(Date);
  });

  it('applyStatus writes status + timestamps + a history row', async () => {
    const pickedUpAt = new Date('2026-01-01T08:10:00Z');
    delivery.update.mockResolvedValue(deliveryRow({ status: 'PICKED_UP', pickedUpAt }));
    const rec = await repo.applyStatus('del-1', DeliveryStatus.PICKED_UP, { pickedUpAt }, 'drv-1', 'ok');
    expect(rec.status).toBe(DeliveryStatus.PICKED_UP);
    expect(delivery.update).toHaveBeenCalledWith({
      where: { id: 'del-1' },
      data: {
        status: DeliveryStatus.PICKED_UP,
        pickedUpAt,
        history: { create: { status: DeliveryStatus.PICKED_UP, changedBy: 'drv-1', note: 'ok' } },
      },
      include: { proof: true, history: { orderBy: { createdAt: 'asc' } } },
    });
  });

  it('completeWithProof marks DELIVERED, nests proof and a history row', async () => {
    delivery.update.mockResolvedValue(deliveryRow({ status: 'DELIVERED', proof: proofRow }));
    const proof = {
      photoUrl: 'p.jpg',
      signatureUrl: 's.png',
      recipientName: 'Budi',
      latitude: -6.2,
      longitude: 106.8,
      note: 'left at gate',
    };
    const rec = await repo.completeWithProof('del-1', proof, 'drv-1');
    expect(rec.status).toBe(DeliveryStatus.DELIVERED);
    const call = delivery.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'del-1' });
    expect(call.data.status).toBe(DeliveryStatus.DELIVERED);
    expect(call.data.deliveredAt).toBeInstanceOf(Date);
    expect(call.data.proof).toEqual({ create: proof });
    expect(call.data.history).toEqual({
      create: { status: DeliveryStatus.DELIVERED, changedBy: 'drv-1' },
    });
  });

  it('purgeProofsBefore deletes and returns the deleted count', async () => {
    const cutoff = new Date('2026-01-01');
    proofOfDelivery.deleteMany.mockResolvedValue({ count: 7 });
    expect(await repo.purgeProofsBefore(cutoff)).toBe(7);
    expect(proofOfDelivery.deleteMany).toHaveBeenCalledWith({
      where: { capturedAt: { lt: cutoff } },
    });
  });

  it('slaStats aggregates a scoped range and derives breached', async () => {
    $queryRaw.mockResolvedValue([{ total: 10n, ontime: 8n, summinutes: 240 }]);
    delivery.count.mockResolvedValue(2);
    const stats = await repo.slaStats(
      { from: new Date('2026-01-01'), to: new Date('2026-02-01') },
      30,
      ['dep-1'],
    );
    expect(stats).toEqual({
      totalDelivered: 10,
      onTime: 8,
      breached: 2,
      sumMinutes: 240,
      failedCount: 2,
    });
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(delivery.count).toHaveBeenCalledWith({
      where: {
        failedAt: { not: null, gte: expect.any(Date), lt: expect.any(Date) },
        depotId: { in: ['dep-1'] },
      },
    });
  });

  it('slaStats handles an unscoped, unbounded range with null summinutes', async () => {
    $queryRaw.mockResolvedValue([{ total: 0n, ontime: 0n, summinutes: null }]);
    delivery.count.mockResolvedValue(0);
    const stats = await repo.slaStats({}, 30);
    expect(stats).toEqual({
      totalDelivered: 0,
      onTime: 0,
      breached: 0,
      sumMinutes: 0,
      failedCount: 0,
    });
    expect(delivery.count).toHaveBeenCalledWith({ where: { failedAt: { not: null } } });
  });

  it('slaStats treats an empty depotIds array as unscoped', async () => {
    $queryRaw.mockResolvedValue([{ total: 1n, ontime: 1n, summinutes: 5 }]);
    delivery.count.mockResolvedValue(0);
    await repo.slaStats({ from: new Date('2026-01-01') }, 30, []);
    expect(delivery.count).toHaveBeenCalledWith({
      where: { failedAt: { not: null, gte: expect.any(Date) } },
    });
  });

  it('slaStatsByDepot maps per-depot aggregate rows', async () => {
    $queryRaw.mockResolvedValue([
      { depotid: 'dep-1', total: 4n, ontime: 3n, summinutes: 90 },
      { depotid: 'dep-2', total: 2n, ontime: 2n, summinutes: null },
    ]);
    const rows = await repo.slaStatsByDepot({ from: new Date('2026-01-01'), to: new Date('2026-02-01') }, 30);
    expect(rows).toEqual([
      { depotId: 'dep-1', totalDelivered: 4, onTime: 3, breached: 1, sumMinutes: 90 },
      { depotId: 'dep-2', totalDelivered: 2, onTime: 2, breached: 0, sumMinutes: 0 },
    ]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('slaStatsByDepot works with an unbounded range', async () => {
    $queryRaw.mockResolvedValue([]);
    expect(await repo.slaStatsByDepot({}, 45)).toEqual([]);
  });
});

describe('IncidentPrismaRepository', () => {
  const fieldIncident = { create: jest.fn(), findMany: jest.fn() };
  const prisma = { fieldIncident } as unknown as PrismaService;
  const repo = new IncidentPrismaRepository(prisma);
  const incidentRow = {
    id: 'inc-1',
    driverId: 'drv-1',
    deliveryId: 'del-1',
    depotId: 'dep-1',
    category: 'ACCIDENT',
    severity: 'HIGH',
    description: 'minor collision',
    photoUrl: null,
    lat: -6.2,
    lng: 106.8,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('create persists and casts category/severity enums', async () => {
    fieldIncident.create.mockResolvedValue(incidentRow);
    const data = {
      driverId: 'drv-1',
      deliveryId: 'del-1',
      depotId: 'dep-1',
      category: IncidentCategory.ACCIDENT,
      severity: IncidentSeverity.HIGH,
      description: 'minor collision',
      photoUrl: null,
      lat: -6.2,
      lng: 106.8,
    };
    const rec = await repo.create(data as never);
    expect(fieldIncident.create).toHaveBeenCalledWith({ data });
    expect(rec.category).toBe(IncidentCategory.ACCIDENT);
    expect(rec.severity).toBe(IncidentSeverity.HIGH);
  });

  it('listByDriver returns the newest first, capped at the limit', async () => {
    fieldIncident.findMany.mockResolvedValue([incidentRow]);
    const rows = await repo.listByDriver('drv-1', 20);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('inc-1');
    expect(fieldIncident.findMany).toHaveBeenCalledWith({
      where: { driverId: 'drv-1' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  });
});

describe('SettlementPrismaRepository', () => {
  const cashSettlement = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { cashSettlement } as unknown as PrismaService;
  const repo = new SettlementPrismaRepository(prisma);
  const settlementRow = (over: Record<string, unknown> = {}) => ({
    id: 'set-1',
    shiftId: 'shf-1',
    driverId: 'drv-1',
    depotId: 'dep-1',
    status: 'SUBMITTED',
    orderIds: ['ord-1'],
    expectedAmount: 100000,
    depositedAmount: 95000,
    variance: -5000,
    chargedToDriver: false,
    note: null,
    verifiedBy: null,
    verifiedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('create persists and casts status', async () => {
    cashSettlement.create.mockResolvedValue(settlementRow());
    const data = {
      shiftId: 'shf-1',
      driverId: 'drv-1',
      depotId: 'dep-1',
      orderIds: ['ord-1'],
      expectedAmount: 100000,
      depositedAmount: 95000,
      variance: -5000,
    };
    const rec = await repo.create(data as never);
    expect(cashSettlement.create).toHaveBeenCalledWith({ data });
    expect(rec.status).toBe(SettlementStatus.SUBMITTED);
  });

  it('findById maps a row and returns null when absent', async () => {
    cashSettlement.findUnique.mockResolvedValueOnce(settlementRow());
    expect((await repo.findById('set-1'))?.id).toBe('set-1');
    expect(cashSettlement.findUnique).toHaveBeenCalledWith({ where: { id: 'set-1' } });
    cashSettlement.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('findByShift queries by shiftId and returns null when absent', async () => {
    cashSettlement.findUnique.mockResolvedValueOnce(settlementRow());
    expect((await repo.findByShift('shf-1'))?.shiftId).toBe('shf-1');
    expect(cashSettlement.findUnique).toHaveBeenCalledWith({ where: { shiftId: 'shf-1' } });
    cashSettlement.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByShift('nope')).toBeNull();
  });

  it('listByDriver clamps the limit to the history cap', async () => {
    cashSettlement.findMany.mockResolvedValue([settlementRow()]);
    await repo.listByDriver('drv-1', 500);
    expect(cashSettlement.findMany).toHaveBeenCalledWith({
      where: { driverId: 'drv-1' },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
  });

  it('listByDriver keeps a limit below the cap', async () => {
    cashSettlement.findMany.mockResolvedValue([]);
    await repo.listByDriver('drv-1', 10);
    expect(cashSettlement.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('search filters by depot and status when given', async () => {
    cashSettlement.findMany.mockResolvedValue([settlementRow({ status: 'VERIFIED' })]);
    const rows = await repo.search({ depotId: 'dep-1', status: SettlementStatus.VERIFIED } as never);
    expect(rows[0].status).toBe(SettlementStatus.VERIFIED);
    expect(cashSettlement.findMany).toHaveBeenCalledWith({
      where: { depotId: 'dep-1', status: SettlementStatus.VERIFIED },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
  });

  it('search omits status when not given', async () => {
    cashSettlement.findMany.mockResolvedValue([]);
    await repo.search({ depotId: 'dep-1' } as never);
    expect(cashSettlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depotId: 'dep-1' } }),
    );
  });

  it('chargedShortfallByDriver reports the absolute owed amount', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    cashSettlement.groupBy.mockResolvedValue([
      { driverId: 'drv-1', _sum: { variance: -5000 } },
      { driverId: 'drv-2', _sum: { variance: null } },
    ]);
    const rows = await repo.chargedShortfallByDriver('dep-1', from, to);
    expect(rows).toEqual([
      { driverId: 'drv-1', shortfallIdr: 5000 },
      { driverId: 'drv-2', shortfallIdr: 0 },
    ]);
    expect(cashSettlement.groupBy).toHaveBeenCalledWith({
      by: ['driverId'],
      where: { depotId: 'dep-1', chargedToDriver: true, createdAt: { gte: from, lt: to } },
      _sum: { variance: true },
    });
  });

  it('resolve applies the patch and maps the row', async () => {
    const patch = { status: SettlementStatus.VERIFIED, verifiedBy: 'cash-1', verifiedAt: new Date(), chargedToDriver: true };
    cashSettlement.update.mockResolvedValue(settlementRow({ status: 'VERIFIED' }));
    const rec = await repo.resolve('set-1', patch as never);
    expect(rec.status).toBe(SettlementStatus.VERIFIED);
    expect(cashSettlement.update).toHaveBeenCalledWith({ where: { id: 'set-1' }, data: patch });
  });
});

describe('ShiftPrismaRepository', () => {
  const shift = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { shift } as unknown as PrismaService;
  const repo = new ShiftPrismaRepository(prisma);
  const shiftRow = (over: Record<string, unknown> = {}) => ({
    id: 'shf-1',
    driverId: 'drv-1',
    depotId: 'dep-1',
    status: 'ONLINE',
    checkInAt: new Date('2026-01-01T08:00:00Z'),
    checkInLat: -6.2,
    checkInLng: 106.8,
    expectedEndAt: new Date('2026-01-01T16:00:00Z'),
    checkOutAt: null,
    checkOutLat: null,
    checkOutLng: null,
    breakSecondsUsed: 0,
    breakStartedAt: null,
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('open persists and casts status', async () => {
    shift.create.mockResolvedValue(shiftRow());
    const data = {
      driverId: 'drv-1',
      depotId: 'dep-1',
      status: ShiftStatus.ONLINE,
      checkInAt: new Date('2026-01-01T08:00:00Z'),
      checkInLat: -6.2,
      checkInLng: 106.8,
      expectedEndAt: new Date('2026-01-01T16:00:00Z'),
    };
    const rec = await repo.open(data as never);
    expect(shift.create).toHaveBeenCalledWith({ data });
    expect(rec.status).toBe(ShiftStatus.ONLINE);
  });

  it('findById maps a row and returns null when absent', async () => {
    shift.findUnique.mockResolvedValueOnce(shiftRow());
    expect((await repo.findById('shf-1'))?.id).toBe('shf-1');
    expect(shift.findUnique).toHaveBeenCalledWith({ where: { id: 'shf-1' } });
    shift.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('findOpenByDriver filters to open statuses, newest first', async () => {
    shift.findFirst.mockResolvedValueOnce(shiftRow());
    expect((await repo.findOpenByDriver('drv-1'))?.id).toBe('shf-1');
    expect(shift.findFirst).toHaveBeenCalledWith({
      where: {
        driverId: 'drv-1',
        status: { in: [ShiftStatus.ONLINE, ShiftStatus.BREAK, ShiftStatus.OFFLINE] },
      },
      orderBy: { checkInAt: 'desc' },
    });
    shift.findFirst.mockResolvedValueOnce(null);
    expect(await repo.findOpenByDriver('drv-2')).toBeNull();
  });

  it('patchStatus applies the patch and maps the row', async () => {
    const patch = { status: ShiftStatus.BREAK, breakStartedAt: new Date() };
    shift.update.mockResolvedValue(shiftRow({ status: 'BREAK' }));
    const rec = await repo.patchStatus('shf-1', patch as never);
    expect(rec.status).toBe(ShiftStatus.BREAK);
    expect(shift.update).toHaveBeenCalledWith({ where: { id: 'shf-1' }, data: patch });
  });

  it('listByDriver returns newest first capped at the limit', async () => {
    shift.findMany.mockResolvedValue([shiftRow()]);
    await repo.listByDriver('drv-1', 15);
    expect(shift.findMany).toHaveBeenCalledWith({
      where: { driverId: 'drv-1' },
      orderBy: { checkInAt: 'desc' },
      take: 15,
    });
  });

  it('search builds a full depot + date-range filter', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    shift.findMany.mockResolvedValue([shiftRow()]);
    await repo.search({ depotId: 'dep-1', from, to } as never);
    expect(shift.findMany).toHaveBeenCalledWith({
      where: { depotId: 'dep-1', checkInAt: { gte: from, lte: to } },
      orderBy: { checkInAt: 'desc' },
    });
  });

  it('search with only from bounds the lower edge', async () => {
    const from = new Date('2026-01-01');
    shift.findMany.mockResolvedValue([]);
    await repo.search({ from } as never);
    expect(shift.findMany).toHaveBeenCalledWith({
      where: { checkInAt: { gte: from } },
      orderBy: { checkInAt: 'desc' },
    });
  });

  it('search with no filters queries everything', async () => {
    shift.findMany.mockResolvedValue([]);
    await repo.search({} as never);
    expect(shift.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { checkInAt: 'desc' } });
  });
});
