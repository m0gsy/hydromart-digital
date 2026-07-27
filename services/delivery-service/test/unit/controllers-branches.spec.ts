import { ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { CommissionController } from '../../src/modules/commission.controller';
import { DriverIncidentController } from '../../src/modules/driver-incident.controller';
import { DriverPerformanceController } from '../../src/modules/driver-performance.controller';
import { DriverDeliveryController } from '../../src/modules/driver-delivery.controller';
import { DriverSettlementController } from '../../src/modules/driver-settlement.controller';
import { DriverShiftController } from '../../src/modules/driver-shift.controller';
import { HealthController } from '../../src/modules/health.controller';
import { RetentionController } from '../../src/modules/retention.controller';
import { SettlementController } from '../../src/modules/settlement.controller';
import { ShiftController } from '../../src/modules/shift.controller';
import { ReportController } from '../../src/modules/report.controller';
import { ContactMethod } from '../../src/domain/no-show';
import { IncidentCategory, IncidentSeverity } from '../../src/domain/incident';
import { ShiftStatus } from '../../src/domain/shift';

const user = { sub: 'user-1' } as AuthenticatedUser;
const depotId = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-0000000000aa';

describe('CommissionController', () => {
  const commission = { run: jest.fn().mockResolvedValue({ rows: [] }) };
  const controller = new CommissionController(commission as never);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T08:00:00.000Z'));
    commission.run.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('defaults the window to the current UTC month', async () => {
    await controller.run({ depotId });
    expect(commission.run).toHaveBeenCalledWith(
      depotId,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
    );
  });

  it('honours an explicit [from,to) window', async () => {
    await controller.run({ depotId, from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' });
    expect(commission.run).toHaveBeenCalledWith(
      depotId,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T00:00:00.000Z'),
    );
  });
});

describe('DriverIncidentController', () => {
  const record = {
    id,
    deliveryId: null,
    category: IncidentCategory.ACCIDENT,
    severity: IncidentSeverity.HIGH,
    description: 'Ban bocor',
    photoUrl: null,
    createdAt: new Date('2026-07-22T08:00:00.000Z'),
  };
  const incidents = {
    report: jest.fn().mockResolvedValue(record),
    listForDriver: jest.fn().mockResolvedValue([record]),
  };
  const controller = new DriverIncidentController(incidents as never);

  it('reports an incident and maps it to the DTO', async () => {
    const dto = { category: IncidentCategory.ACCIDENT, severity: IncidentSeverity.HIGH, description: 'Ban bocor' };
    const out = await controller.report(user, dto as never);
    expect(incidents.report).toHaveBeenCalledWith(user.sub, dto);
    expect(out).toMatchObject({ id, category: IncidentCategory.ACCIDENT });
  });

  it("lists the driver's own incidents mapped to DTOs", async () => {
    const out = await controller.list(user);
    expect(incidents.listForDriver).toHaveBeenCalledWith(user.sub);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(id);
  });
});

describe('HealthController', () => {
  it('returns ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as never);
    const res = await controller.check();
    expect(res.status).toBe('ok');
    expect(res.checks).toEqual({ database: 'up' });
  });

  it('throws 503 when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    const controller = new HealthController(prisma as never);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('DriverPerformanceController', () => {
  it('delegates the weekly roll-up with the query args', () => {
    const performance = { weekly: jest.fn().mockResolvedValue({ delivered: 0 }) };
    const controller = new DriverPerformanceController(performance as never);
    void controller.weekly(user, { weekStart: '2026-07-20', depotId } as never);
    expect(performance.weekly).toHaveBeenCalledWith(user.sub, '2026-07-20', depotId);
  });
});

describe('RetentionController', () => {
  it('delegates the retention purge', () => {
    const deliveries = { purgeExpiredProofs: jest.fn().mockResolvedValue({ purged: 3 }) };
    const controller = new RetentionController(deliveries as never);
    void controller.purgeExpired();
    expect(deliveries.purgeExpiredProofs).toHaveBeenCalled();
  });
});

describe('SettlementController (cashier)', () => {
  const settlements = {
    searchForDepot: jest.fn().mockResolvedValue([]),
    verify: jest.fn().mockResolvedValue({ id }),
    dispute: jest.fn().mockResolvedValue({ id }),
  };
  const controller = new SettlementController(settlements as never);

  it('lists a depot filtered by status', () => {
    void controller.list({ depotId, status: undefined } as never);
    expect(settlements.searchForDepot).toHaveBeenCalledWith(depotId, undefined);
  });

  it('verifies a deposit', () => {
    const dto = { chargeShortfall: true };
    void controller.verify(user, id, dto as never);
    expect(settlements.verify).toHaveBeenCalledWith(user, id, dto);
  });

  it('disputes a deposit with a note', () => {
    void controller.dispute(user, id, { note: 'off by 5k' } as never);
    expect(settlements.dispute).toHaveBeenCalledWith(user, id, 'off by 5k');
  });
});

describe('DriverDeliveryController', () => {
  const deliveries = {
    listForDriver: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getForDriver: jest.fn().mockResolvedValue({ id }),
    pickup: jest.fn().mockResolvedValue({ id }),
    start: jest.fn().mockResolvedValue({ id }),
    complete: jest.fn().mockResolvedValue({ id }),
    reportLocation: jest.fn().mockResolvedValue({ id }),
    fail: jest.fn().mockResolvedValue({ id }),
    recordContactAttempt: jest.fn().mockResolvedValue({ canDeclareNoShow: false }),
    markNoShow: jest.fn().mockResolvedValue({ id }),
    reschedule: jest.fn().mockResolvedValue({ id }),
  };
  const controller = new DriverDeliveryController(deliveries as never);
  const auth = 'Bearer t';

  it('lists and gets the driver own deliveries', () => {
    void controller.list(user, { page: 1, limit: 20 } as never);
    expect(deliveries.listForDriver).toHaveBeenCalledWith(user.sub, { page: 1, limit: 20 });
    void controller.get(user, id);
    expect(deliveries.getForDriver).toHaveBeenCalledWith(user.sub, id);
  });

  it('advances pickup and start with the forwarded bearer', () => {
    void controller.pickup(user, id, auth);
    expect(deliveries.pickup).toHaveBeenCalledWith(user.sub, id, auth);
    void controller.start(user, id, auth);
    expect(deliveries.start).toHaveBeenCalledWith(user.sub, id, auth);
  });

  it('completes with proof, defaulting the optional signature/note to null', () => {
    void controller.complete(
      user,
      id,
      { photoUrl: 'p', recipientName: 'Budi', latitude: -6.9, longitude: 107.6 } as never,
      auth,
    );
    expect(deliveries.complete).toHaveBeenCalledWith(
      user.sub,
      id,
      { photoUrl: 'p', signatureUrl: null, recipientName: 'Budi', latitude: -6.9, longitude: 107.6, note: null },
      auth,
    );
  });

  it('completes with proof, keeping a provided signature/note', () => {
    void controller.complete(
      user,
      id,
      { photoUrl: 'p', signatureUrl: 's', recipientName: 'Budi', latitude: -6.9, longitude: 107.6, note: 'ok' } as never,
      auth,
    );
    expect(deliveries.complete).toHaveBeenCalledWith(
      user.sub,
      id,
      { photoUrl: 'p', signatureUrl: 's', recipientName: 'Budi', latitude: -6.9, longitude: 107.6, note: 'ok' },
      auth,
    );
  });

  it('reports a location and fails a delivery', () => {
    void controller.reportLocation(user, id, { lat: -6.9, lng: 107.6 } as never);
    expect(deliveries.reportLocation).toHaveBeenCalledWith(user.sub, id, -6.9, 107.6);
    void controller.fail(user, id, { reason: 'not found' } as never, 'Bearer t');
    expect(deliveries.fail).toHaveBeenCalledWith(user.sub, id, 'not found', 'Bearer t');
  });

  it('defaults the contact-attempt method to CALL when omitted', () => {
    void controller.recordContactAttempt(user, id, { note: 'no answer' } as never);
    expect(deliveries.recordContactAttempt).toHaveBeenCalledWith(user.sub, id, ContactMethod.CALL, 'no answer');
  });

  it('passes an explicit contact-attempt method through', () => {
    void controller.recordContactAttempt(user, id, { method: ContactMethod.WHATSAPP } as never);
    expect(deliveries.recordContactAttempt).toHaveBeenCalledWith(user.sub, id, ContactMethod.WHATSAPP, undefined);
  });

  it('marks a no-show and reschedules (parsing the date)', () => {
    void controller.markNoShow(user, id, 'Bearer t');
    expect(deliveries.markNoShow).toHaveBeenCalledWith(user.sub, id, expect.any(Date), 'Bearer t');
    void controller.reschedule(user, id, { rescheduledFor: '2026-08-01T09:00:00.000Z', slot: 'Sore', note: 'n' } as never);
    expect(deliveries.reschedule).toHaveBeenCalledWith(user.sub, id, {
      rescheduledFor: new Date('2026-08-01T09:00:00.000Z'),
      slot: 'Sore',
      note: 'n',
    });
  });
});

describe('DriverSettlementController', () => {
  const settlements = {
    listForDriver: jest.fn().mockResolvedValue([]),
    getForDriver: jest.fn().mockResolvedValue({ id }),
    submit: jest.fn().mockResolvedValue({ id }),
  };
  const controller = new DriverSettlementController(settlements as never);

  it('delegates history, get and submit', () => {
    void controller.history(user);
    expect(settlements.listForDriver).toHaveBeenCalledWith(user.sub);
    void controller.get(user, id);
    expect(settlements.getForDriver).toHaveBeenCalledWith(user.sub, id);
    void controller.submit(user, 'Bearer t', { shiftId: 's1', depositedAmount: 60000 } as never);
    expect(settlements.submit).toHaveBeenCalledWith(user.sub, 's1', 60000, 'Bearer t');
  });
});

describe('DriverShiftController', () => {
  const shifts = {
    current: jest.fn().mockResolvedValue(null),
    history: jest.fn().mockResolvedValue([]),
    checkIn: jest.fn().mockResolvedValue({ id }),
    checkOut: jest.fn().mockResolvedValue({ id }),
    setStatus: jest.fn().mockResolvedValue({ id }),
  };
  const controller = new DriverShiftController(shifts as never);

  it('delegates every shift action', () => {
    void controller.current(user);
    expect(shifts.current).toHaveBeenCalledWith(user.sub);
    void controller.history(user);
    expect(shifts.history).toHaveBeenCalledWith(user.sub);
    void controller.checkIn(user, { depotId, lat: -6.9, lng: 107.6 } as never);
    expect(shifts.checkIn).toHaveBeenCalledWith(user.sub, depotId, -6.9, 107.6);
    void controller.checkOut(user, id, { lat: -6.9, lng: 107.6 } as never);
    expect(shifts.checkOut).toHaveBeenCalledWith(user.sub, id, -6.9, 107.6);
    void controller.setStatus(user, id, { status: ShiftStatus.BREAK } as never);
    expect(shifts.setStatus).toHaveBeenCalledWith(user.sub, id, ShiftStatus.BREAK);
  });
});

describe('ShiftController (dispatch)', () => {
  const shifts = { search: jest.fn().mockResolvedValue([]) };
  const controller = new ShiftController(shifts as never);

  it('lists with an explicit window', () => {
    void controller.list({ depotId, from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T00:00:00.000Z' } as never);
    expect(shifts.search).toHaveBeenCalledWith({
      depotId,
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-31T00:00:00.000Z'),
    });
  });

  it('lists with the window omitted (undefined bounds)', () => {
    void controller.list({ depotId } as never);
    expect(shifts.search).toHaveBeenCalledWith({ depotId, from: undefined, to: undefined });
  });
});

describe('ReportController delegation', () => {
  const reports = {
    sla: jest.fn().mockResolvedValue({ totalDelivered: 0 }),
    slaByDepot: jest.fn().mockResolvedValue({ depots: [] }),
  };
  const controller = new ReportController(reports as never);

  it('delegates sla, translating the range and passing filters', () => {
    void controller.sla({ from: '2026-07-01T00:00:00.000Z', thresholdMinutes: 90, depotIds: [depotId] } as never);
    expect(reports.sla).toHaveBeenCalledWith(
      { from: new Date('2026-07-01T00:00:00.000Z'), to: undefined },
      90,
      [depotId],
    );
  });

  it('delegates slaByDepot with an empty range', () => {
    void controller.slaByDepot({} as never);
    expect(reports.slaByDepot).toHaveBeenCalledWith({ from: undefined, to: undefined }, undefined);
  });
});
