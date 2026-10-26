import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SettlementService } from '../../src/application/services/settlement.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { DeliveryReportDataset, REPORT_TABLE_ROW_CAP } from '../../src/domain/report-table';
import { ReportTableQueryDto } from '../../src/modules/dto/settlement.dto';
import { SettlementController } from '../../src/modules/settlement.controller';
import {
  FakeCashCollection,
  FakeCourierPayout,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

/** The flat tables admin-service renders into scheduled reports. */
const DEPOT = '00000000-0000-4000-8000-000000000001';
const TO = new Date('2026-10-26T00:00:00.000Z');
const FROM = new Date('2026-10-25T00:00:00.000Z');
const ago = (days: number) => new Date(TO.getTime() - days * 86_400_000);

describe('SettlementService.reportTable', () => {
  let deliveries: InMemoryDeliveryRepository;
  let service: SettlementService;
  const driverA = randomUUID();
  const driverB = randomUUID();

  beforeEach(() => {
    deliveries = new InMemoryDeliveryRepository();
    service = new SettlementService(
      new InMemorySettlementRepository(),
      new InMemoryShiftRepository(),
      deliveries,
      new FakeCashCollection(),
      new FakeCourierPayout(),
      { settlementExpectFromCod: () => true } as never,
    );
  });

  const add = async (
    driverId: string,
    status: DeliveryStatus,
    timestamps: Record<string, Date | string>,
    cod: number | null = null,
    depotId: string | null = DEPOT,
  ) => {
    const d = await deliveries.create({
      orderId: randomUUID(),
      orderNumber: `HM-${randomUUID().slice(0, 4)}`,
      driverId,
      depotId,
      destinationAddress: 'x',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount: cod,
      notes: null,
    });
    await deliveries.applyStatus(d.id, DeliveryStatus.ASSIGNED, status, timestamps, driverId, null);
    return d;
  };

  it('COD_UNSETTLED groups delivered COD per courier and depot, with age as of `to`', async () => {
    await add(driverA, DeliveryStatus.DELIVERED, { deliveredAt: ago(3) }, 50_000);
    await add(driverA, DeliveryStatus.DELIVERED, { deliveredAt: ago(1) }, 25_000);
    await add(driverB, DeliveryStatus.DELIVERED, { deliveredAt: ago(2) }, 100_000, null);
    const settled = await add(driverB, DeliveryStatus.DELIVERED, { deliveredAt: ago(2) }, 9_000);
    deliveries.settledOrderIds.add(settled.orderId);
    await add(driverA, DeliveryStatus.DELIVERED, { deliveredAt: ago(40) }, 7_000); // too old
    await add(driverA, DeliveryStatus.DELIVERED, { deliveredAt: ago(0) }, 7_000); // `to` is exclusive
    await add(driverA, DeliveryStatus.FAILED, { failedAt: ago(1) }, 5_000);

    const table = await service.reportTable(DeliveryReportDataset.COD_UNSETTLED, FROM, TO);

    expect(table.columns.map((c) => [c.key, c.type])).toEqual([
      ['courier', 'text'],
      ['depot', 'text'],
      ['deliveries', 'int'],
      ['amount', 'money'],
      ['oldest', 'date'],
      ['ageDays', 'int'],
    ]);
    expect(table.rows).toEqual([
      [driverB, null, 1, 100_000, ago(2).toISOString(), 2],
      [driverA, DEPOT, 2, 75_000, ago(3).toISOString(), 3],
    ]);
    expect(table.truncated).toBe(false);
  });

  it('FAILED_DELIVERIES lists handed-back deliveries in [from, to), newest first, with the reason', async () => {
    const at = new Date('2026-10-25T08:00:00.000Z');
    await add(driverA, DeliveryStatus.FAILED, { failedAt: at, failureReason: 'Rumah kosong' });
    await add(driverB, DeliveryStatus.FAILED, { failedAt: new Date('2026-10-25T10:00:00.000Z') });
    await add(driverA, DeliveryStatus.FAILED, { failedAt: new Date('2026-10-24T08:00:00.000Z') });
    await add(driverA, DeliveryStatus.DELIVERED, { deliveredAt: at });

    const table = await service.reportTable(DeliveryReportDataset.FAILED_DELIVERIES, FROM, TO);

    expect(table.columns.map((c) => c.key)).toEqual([
      'at',
      'order',
      'courier',
      'depot',
      'status',
      'reason',
    ]);
    expect(table.rows.map((r) => [r[0], r[2], r[4], r[5]])).toEqual([
      ['2026-10-25T10:00:00.000Z', driverB, 'Gagal', null],
      [at.toISOString(), driverA, 'Gagal', 'Rumah kosong'],
    ]);
    expect(table.truncated).toBe(false);
  });

  it('labels a rescheduled delivery and takes its note as the reason', async () => {
    await add(driverA, DeliveryStatus.RESCHEDULED, { rescheduleNote: 'Minta besok' });
    // RESCHEDULED has no failedAt: updatedAt (a fake clock here) is the anchor, so window it wide.
    const table = await service.reportTable(
      DeliveryReportDataset.FAILED_DELIVERIES,
      new Date(0),
      new Date(8_640_000_000_000_000),
    );
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].slice(4)).toEqual(['Dijadwalkan ulang', 'Minta besok']);
  });

  it('says truncated and drops the probe row once the cap is exceeded', async () => {
    jest.spyOn(deliveries, 'failedInWindow').mockImplementation(async (_f, _t, limit) => {
      expect(limit).toBe(REPORT_TABLE_ROW_CAP + 1);
      return Array.from({ length: limit }, (_, i) => ({
        orderNumber: `HM-${i}`,
        driverId: driverA,
        depotId: DEPOT,
        status: DeliveryStatus.FAILED,
        at: FROM,
        reason: null,
      }));
    });
    const table = await service.reportTable(DeliveryReportDataset.FAILED_DELIVERIES, FROM, TO);
    expect(table.rows).toHaveLength(REPORT_TABLE_ROW_CAP);
    expect(table.truncated).toBe(true);
  });

  it('the controller passes the window through, and the DTO refuses unknown datasets and bad dates', async () => {
    const reportTable = jest.fn().mockResolvedValue({ columns: [], rows: [], truncated: false });
    const controller = new SettlementController({ reportTable } as never);
    await controller.reportTable({
      dataset: DeliveryReportDataset.COD_UNSETTLED,
      from: FROM.toISOString(),
      to: TO.toISOString(),
    });
    expect(reportTable).toHaveBeenCalledWith(DeliveryReportDataset.COD_UNSETTLED, FROM, TO);

    const bad = plainToInstance(ReportTableQueryDto, { dataset: 'NOPE', from: 'x', to: 'y' });
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual(['dataset', 'from', 'to']);
    const ok = plainToInstance(ReportTableQueryDto, {
      dataset: 'FAILED_DELIVERIES',
      from: FROM.toISOString(),
      to: TO.toISOString(),
    });
    expect(await validate(ok)).toEqual([]);
  });
});
