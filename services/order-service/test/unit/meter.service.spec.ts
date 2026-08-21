import { OrderConfigService } from '../../src/config/order-config.service';
import { MeterService } from '../../src/application/services/meter.service';
import {
  MeterReadingBackwardsError,
  MeterReadingNotOpenedError,
} from '../../src/domain/errors';
import { MeterReading } from '../../src/domain/meter-reading';
import {
  MeterReadingRepository,
  UpsertMeterReadingData,
} from '../../src/application/ports/meter-reading.repository';
import { NotificationPort } from '../../src/application/ports/notification.port';
import { OrderRecord, OrderRepository } from '../../src/application/ports/order.repository';
import { OrderStatus } from '../../src/domain/order-status';

const DEPOT = 'd1';
const DATE = '2026-08-02';

class FakeMeterRepo implements MeterReadingRepository {
  rows = new Map<string, MeterReading>();
  alerted: string[] = [];

  seed(over: Partial<MeterReading> = {}): MeterReading {
    const row: MeterReading = {
      depotId: DEPOT,
      date: DATE,
      openingM3: 1000,
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
    this.rows.set(`${row.depotId}|${row.date}`, row);
    return row;
  }

  async upsertForDate(data: UpsertMeterReadingData): Promise<MeterReading | null> {
    const key = `${data.depotId}|${data.date}`;
    const existing = this.rows.get(key);
    if (!existing) {
      if (data.openingM3 === undefined) return null;
      return this.seed({
        openingM3: data.openingM3,
        closingM3: data.closingM3 ?? null,
        sourceOpeningM3: data.sourceOpeningM3 ?? null,
        sourceClosingM3: data.sourceClosingM3 ?? null,
        openedBy: data.actorId,
        note: data.note ?? null,
      });
    }
    const merged: MeterReading = {
      ...existing,
      ...(data.openingM3 !== undefined ? { openingM3: data.openingM3 } : {}),
      ...(data.closingM3 !== undefined ? { closingM3: data.closingM3 } : {}),
      ...(data.sourceOpeningM3 !== undefined ? { sourceOpeningM3: data.sourceOpeningM3 } : {}),
      ...(data.sourceClosingM3 !== undefined ? { sourceClosingM3: data.sourceClosingM3 } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    };
    this.rows.set(key, merged);
    return merged;
  }

  async findForDate(depotId: string, date: string): Promise<MeterReading | null> {
    return this.rows.get(`${depotId}|${date}`) ?? null;
  }

  async listForRange(depotId: string, from: string, to: string): Promise<MeterReading[]> {
    return [...this.rows.values()]
      .filter((r) => r.depotId === depotId && r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async markAlerted(depotId: string, date: string): Promise<void> {
    this.alerted.push(`${depotId}|${date}`);
    const key = `${depotId}|${date}`;
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, alertedAt: new Date() });
  }
}

class SpyNotification implements NotificationPort {
  calls: { event: string; phone: string; vars: Record<string, string> }[] = [];
  throwOnNotify = false;

  async notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    _customerId: string | null,
    _authorization: string,
  ): Promise<boolean> {
    if (this.throwOnNotify) throw new Error('crm down');
    this.calls.push({ event, phone, vars });
    return true;
  }
}

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    status: OrderStatus.DELIVERED,
    createdAt: new Date(`${DATE}T08:00:00.000Z`),
    total: 2600000,
    items: [
      { quantity: 120, volumeMl: 19000, isGallon: true },
      { quantity: 10, volumeMl: 15000, isGallon: true },
    ],
    ...over,
  } as unknown as OrderRecord;
}

function build(
  opts: {
    orders?: OrderRecord[];
    alertPhone?: string;
    toleranceLiters?: number;
  } = {},
): {
  service: MeterService;
  repo: FakeMeterRepo;
  notifications: SpyNotification;
  orders: { ordersForDepot: jest.Mock };
} {
  const repo = new FakeMeterRepo();
  const notifications = new SpyNotification();
  const orders = { ordersForDepot: jest.fn(async () => opts.orders ?? [order()]) };
  const config = {
    meterReferenceVolumeMl: () => 19000,
    meterVarianceToleranceLiters: () => opts.toleranceLiters ?? 200,
    alertPhone: opts.alertPhone ?? '+628123',
  } as unknown as OrderConfigService;
  return {
    service: new MeterService(repo, orders as unknown as OrderRepository, notifications, config),
    repo,
    notifications,
    orders,
  };
}

describe('MeterService.save', () => {
  it('records the opening reading in the morning and reports the day as not comparable', async () => {
    const { service } = build();
    const result = await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-1',
      authorization: 'Bearer t',
      openingM3: 1000,
    });
    expect(result.meterLiters).toBeNull();
    expect(result.soldLiters).toBe(2430);
  });

  it('accepts a closing-only evening write against the morning row', async () => {
    const { service, repo } = build();
    repo.seed({ openingM3: 1000 });
    const result = await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: 'Bearer t',
      closingM3: 1002.6,
    });
    expect(result.meterLiters).toBe(2600);
    expect(result.varianceLiters).toBe(170);
  });

  it('rejects a closing reading below the opening one', async () => {
    const { service, repo } = build();
    repo.seed({ openingM3: 1000 });
    await expect(
      service.save({
        depotId: DEPOT,
        date: DATE,
        actorId: 'staff-2',
        authorization: '',
        closingM3: 999,
      }),
    ).rejects.toBeInstanceOf(MeterReadingBackwardsError);
  });

  it('rejects a raw-water pair that runs backwards', async () => {
    const { service } = build();
    await expect(
      service.save({
        depotId: DEPOT,
        date: DATE,
        actorId: 'staff-1',
        authorization: '',
        openingM3: 1000,
        sourceOpeningM3: 500,
        sourceClosingM3: 499,
      }),
    ).rejects.toBeInstanceOf(MeterReadingBackwardsError);
  });

  it('refuses a closing-only write for a day that was never opened', async () => {
    const { service } = build();
    await expect(
      service.save({
        depotId: DEPOT,
        date: DATE,
        actorId: 'staff-2',
        authorization: '',
        closingM3: 1002,
      }),
    ).rejects.toBeInstanceOf(MeterReadingNotOpenedError);
  });

  it('surfaces a repository that cannot open the day as the same domain error', async () => {
    const { service, repo } = build();
    repo.seed({ openingM3: 1000 });
    jest.spyOn(repo, 'upsertForDate').mockResolvedValueOnce(null);
    await expect(
      service.save({
        depotId: DEPOT,
        date: DATE,
        actorId: 'staff-2',
        authorization: '',
        closingM3: 1002,
      }),
    ).rejects.toBeInstanceOf(MeterReadingNotOpenedError);
  });

  it('validates the merged row, not the patch, so an old opening still guards', async () => {
    const { service, repo } = build();
    repo.seed({ openingM3: 1000, closingM3: 1005 });
    // Lowering only the opening must still be checked against the stored closing.
    await expect(
      service.save({
        depotId: DEPOT,
        date: DATE,
        actorId: 'staff-1',
        authorization: '',
        openingM3: 1006,
      }),
    ).rejects.toBeInstanceOf(MeterReadingBackwardsError);
  });

  it('stores the raw-water pair so RO recovery can be reported', async () => {
    const { service, repo } = build();
    const result = await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-1',
      authorization: '',
      openingM3: 1000,
      closingM3: 1002.6,
      sourceOpeningM3: 500,
      sourceClosingM3: 504,
    });
    expect(await repo.findForDate(DEPOT, DATE)).toMatchObject({
      sourceOpeningM3: 500,
      sourceClosingM3: 504,
    });
    expect(result.roYieldPct).toBe(65); // 2600 L treated out of 4000 L raw
  });

  it('stores an optional note', async () => {
    const { service, repo } = build();
    await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-1',
      authorization: '',
      openingM3: 1000,
      note: 'meter berembun',
    });
    expect((await repo.findForDate(DEPOT, DATE))?.note).toBe('meter berembun');
  });
});

describe('MeterService variance alert', () => {
  const wideGap = { openingM3: 1000, closingM3: 1010 }; // 10_000 L out vs 2_430 L sold

  it('fires once when the gap crosses the tolerance', async () => {
    const { service, repo, notifications } = build();
    repo.seed({ openingM3: wideGap.openingM3 });
    await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: 'Bearer t',
      closingM3: wideGap.closingM3,
    });
    expect(notifications.calls).toHaveLength(1);
    expect(notifications.calls[0].event).toBe('METER_VARIANCE');
    expect(notifications.calls[0].vars.variance).toBe('7570');
    expect(repo.alerted).toEqual([`${DEPOT}|${DATE}`]);
  });

  it('does not fire again when the operator corrects a typo and saves once more', async () => {
    const { service, repo, notifications } = build();
    repo.seed({ openingM3: wideGap.openingM3 });
    await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: '',
      closingM3: wideGap.closingM3,
    });
    await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: '',
      closingM3: 1011,
    });
    expect(notifications.calls).toHaveLength(1);
  });

  it('stays quiet inside the tolerance', async () => {
    const { service, repo, notifications } = build();
    repo.seed({ openingM3: 1000 });
    await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: '',
      closingM3: 1002.6, // 170 L gap, tolerance 200
    });
    expect(notifications.calls).toHaveLength(0);
  });

  it('skips delivery when no ops number is configured', async () => {
    const { service, repo, notifications } = build({ alertPhone: '' });
    repo.seed({ openingM3: wideGap.openingM3 });
    await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: '',
      closingM3: wideGap.closingM3,
    });
    expect(notifications.calls).toHaveLength(0);
    expect(repo.alerted).toHaveLength(0);
  });

  it('never rejects the reading because the alert could not be delivered', async () => {
    const { service, repo, notifications } = build();
    notifications.throwOnNotify = true;
    repo.seed({ openingM3: wideGap.openingM3 });
    const result = await service.save({
      depotId: DEPOT,
      date: DATE,
      actorId: 'staff-2',
      authorization: '',
      closingM3: wideGap.closingM3,
    });
    expect(result.meterLiters).toBe(10000);
    // Not marked alerted, so a later save can retry the delivery.
    expect(repo.alerted).toHaveLength(0);
  });
});

describe('MeterService reads', () => {
  it('reconciles a stored day without writing to it', async () => {
    const { service, repo } = build();
    repo.seed({ openingM3: 1000, closingM3: 1002.6 });
    const result = await service.reconcile(DEPOT, DATE);
    expect(result.varianceLiters).toBe(170);
  });

  it('reports an unrecorded day as empty rather than failing', async () => {
    const { service } = build();
    const result = await service.reconcile(DEPOT, DATE);
    expect(result.reading).toBeNull();
    expect(result.meterLiters).toBeNull();
  });

  it('excludes cancelled orders from the sales side', async () => {
    const { service, repo } = build({
      orders: [order(), order({ status: OrderStatus.CANCELLED, total: 999999 })],
    });
    repo.seed({ openingM3: 1000, closingM3: 1002.6 });
    const result = await service.reconcile(DEPOT, DATE);
    expect(result.soldLiters).toBe(2430);
    expect(result.revenueIdr).toBe(2600000);
  });

  it('counts litres from orders that are not delivered yet, but not their gallons', async () => {
    const { service, repo } = build({ orders: [order({ status: OrderStatus.PREPARING })] });
    repo.seed({ openingM3: 1000, closingM3: 1002.6 });
    const result = await service.reconcile(DEPOT, DATE);
    expect(result.soldLiters).toBe(2430);
    expect(result.gallonsDelivered).toBe(0);
    expect(result.varianceIdr).toBeNull();
  });

  // C2: a meter reading is taken by depot staff on a LOCAL day, so the sales it is compared
  // against must be the same local day. Bucketing on UTC pushed every order between
  // midnight and 07:00 WIB onto the day before — the meter says water left the tank today,
  // the sales say it was sold yesterday, and the variance alert fires at both ends.
  it('buckets sales by the LOCAL day the meter was read on', async () => {
    const { service, repo, orders } = build({
      orders: [
        // 07:30 WIB on 2 Aug — 00:30 UTC, so UTC bucketing files it under 2 Aug anyway.
        order({ createdAt: new Date('2026-08-01T23:00:00.000Z') }), // 06:00 WIB, 2 Aug
        order({ createdAt: new Date('2026-08-02T03:00:00.000Z') }), // 10:00 WIB, 2 Aug
      ],
    });
    repo.seed({ date: '2026-08-02', openingM3: 1000, closingM3: 1002.5 });
    const rows = await service.history(DEPOT, '2026-08-02', '2026-08-02');
    expect(rows).toHaveLength(1);
    // Both sales belong to 2 August in WIB. On UTC the first one lands on 1 August and
    // this row would only see one of them.
    expect(rows[0].soldLiters).toBe(4860); // 2 orders × 2.430 L; on UTC only one is seen
    // …and the window read from the database is the local day, not the UTC one.
    expect(orders.ordersForDepot).toHaveBeenCalledWith(DEPOT, {
      from: new Date('2026-08-01T17:00:00.000Z'),
      to: new Date('2026-08-02T17:00:00.000Z'),
    });
  });

  it('returns one history row per recorded day, oldest first', async () => {
    const { service, repo, orders } = build({
      orders: [
        order({ createdAt: new Date('2026-08-01T08:00:00.000Z') }),
        order({ createdAt: new Date('2026-08-02T08:00:00.000Z') }),
      ],
    });
    repo.seed({ date: '2026-08-01', openingM3: 1000, closingM3: 1002.5 });
    repo.seed({ date: '2026-08-02', openingM3: 1002.5, closingM3: 1005 });
    const rows = await service.history(DEPOT, '2026-08-01', '2026-08-02');
    expect(rows.map((r) => r.day)).toEqual(['2026-08-01', '2026-08-02']);
    expect(rows[0].meterLiters).toBe(2500);
    expect(rows[0].varianceLiters).toBe(70);
    // The whole window is read once and bucketed — not once per day on the chart (H-48).
    expect(orders.ordersForDepot).toHaveBeenCalledTimes(1);
    // C2: the window is the LOCAL span of those two days — 01 Aug 00:00 WIB is
    // 31 Jul 17:00 UTC — not the UTC span that used to be read.
    expect(orders.ordersForDepot).toHaveBeenCalledWith(DEPOT, {
      from: new Date('2026-07-31T17:00:00.000Z'),
      to: new Date('2026-08-02T17:00:00.000Z'),
    });
  });

  it('sums every order that falls on the same day into that day s row', async () => {
    const { service, repo } = build({
      // Both in WIB on 1 August: 15:00 and 21:00. The second one used to be written as
      // 17:30 UTC — which is 00:30 WIB on the SECOND of August, so under the local-day
      // bucketing this test's own premise no longer held (C2).
      orders: [
        order({ createdAt: new Date('2026-08-01T08:00:00.000Z') }),
        order({ createdAt: new Date('2026-08-01T14:00:00.000Z') }),
      ],
    });
    repo.seed({ date: '2026-08-01', openingM3: 1000, closingM3: 1002.5 });
    const rows = await service.history(DEPOT, '2026-08-01', '2026-08-01');
    expect(rows[0].soldLiters).toBe(4860);
  });

  it('gives a day with no orders in the window a zero sales side', async () => {
    const { service, repo } = build({
      orders: [order({ createdAt: new Date('2026-08-01T08:00:00.000Z') })],
    });
    repo.seed({ date: '2026-08-01', openingM3: 1000, closingM3: 1002.5 });
    repo.seed({ date: '2026-08-02', openingM3: 1002.5, closingM3: 1005 });
    const rows = await service.history(DEPOT, '2026-08-01', '2026-08-02');
    expect(rows[0].soldLiters).toBe(2430);
    expect(rows[1].soldLiters).toBe(0);
  });

  it('returns nothing for a range with no readings', async () => {
    const { service } = build();
    expect(await service.history(DEPOT, '2026-07-01', '2026-07-31')).toEqual([]);
  });
});
