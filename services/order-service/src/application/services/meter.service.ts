import { Inject, Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { MeterReadingBackwardsError, MeterReadingNotOpenedError } from '../../domain/errors';
import {
  MeterHistoryRow,
  MeterReading,
  MeterReconciliation,
  SoldTotals,
  reconcile,
  sumSoldLiters,
} from '../../domain/meter-reading';
import { NotificationPort } from '../ports/notification.port';
import { MeterReadingRepository, UpsertMeterReadingData } from '../ports/meter-reading.repository';
import { OrderRepository } from '../ports/order.repository';
import { OrderStatus } from '../../domain/order-status';
import { ORDER_TOKENS } from '../tokens';
import { gallonQty, isDelivered } from './report.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SaveMeterReadingInput {
  depotId: string;
  date: string;
  actorId: string;
  authorization: string;
  openingM3?: number;
  closingM3?: number;
  sourceOpeningM3?: number;
  sourceClosingM3?: number;
  note?: string;
}

/**
 * Depot water-meter reconciliation. The operator writes the dial twice a day; this
 * compares the water that left the plant against the litres the day's recorded
 * sales account for, and raises one ops alert per day when the gap is too wide.
 *
 * The sales side deliberately reuses report.service's own `gallonQty`/`isDelivered`
 * and the same UTC day window as `depotDaily`, so the two screens can never disagree
 * about what "today" or "a galon" means.
 */
@Injectable()
export class MeterService {
  private readonly logger = new Logger(MeterService.name);

  constructor(
    @Inject(ORDER_TOKENS.MeterReadingRepository)
    private readonly readings: MeterReadingRepository,
    @Inject(ORDER_TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(ORDER_TOKENS.Notification) private readonly notifications: NotificationPort,
    private readonly config: OrderConfigService,
  ) {}

  /**
   * Partial upsert: the morning call carries `openingM3`, the evening one `closingM3`.
   * Validation runs against the merged row, not the patch, so an evening write is
   * still checked against the morning number it never sent.
   */
  async save(input: SaveMeterReadingInput): Promise<MeterReconciliation> {
    const existing = await this.readings.findForDate(input.depotId, input.date);
    const opening = input.openingM3 ?? existing?.openingM3 ?? null;
    if (opening === null) {
      throw new MeterReadingNotOpenedError();
    }
    const closing = input.closingM3 ?? existing?.closingM3 ?? null;
    if (closing !== null && closing < opening) {
      throw new MeterReadingBackwardsError('produksi');
    }
    const sourceOpening = input.sourceOpeningM3 ?? existing?.sourceOpeningM3 ?? null;
    const sourceClosing = input.sourceClosingM3 ?? existing?.sourceClosingM3 ?? null;
    if (sourceOpening !== null && sourceClosing !== null && sourceClosing < sourceOpening) {
      throw new MeterReadingBackwardsError('air baku');
    }

    const patch: UpsertMeterReadingData = {
      depotId: input.depotId,
      date: input.date,
      actorId: input.actorId,
      ...(input.openingM3 !== undefined ? { openingM3: input.openingM3 } : {}),
      ...(input.closingM3 !== undefined ? { closingM3: input.closingM3 } : {}),
      ...(input.sourceOpeningM3 !== undefined ? { sourceOpeningM3: input.sourceOpeningM3 } : {}),
      ...(input.sourceClosingM3 !== undefined ? { sourceClosingM3: input.sourceClosingM3 } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    };
    const saved = await this.readings.upsertForDate(patch);
    if (!saved) {
      throw new MeterReadingNotOpenedError();
    }

    const result = await this.reconcileWith(input.depotId, input.date, saved);
    await this.maybeAlert(result, saved, input.authorization);
    return result;
  }

  async reconcile(depotId: string, date: string): Promise<MeterReconciliation> {
    const reading = await this.readings.findForDate(depotId, date);
    return this.reconcileWith(depotId, date, reading);
  }

  /** Per-day rows for the history chart. Days with no reading are simply absent. */
  async history(depotId: string, from: string, to: string): Promise<MeterHistoryRow[]> {
    const readings = await this.readings.listForRange(depotId, from, to);
    const rows: MeterHistoryRow[] = [];
    for (const reading of readings) {
      const totals = await this.soldTotals(depotId, reading.date);
      const result = reconcile({
        depotId,
        date: reading.date,
        reading,
        totals,
        referenceVolumeMl: this.config.meterReferenceVolumeMl(depotId),
        toleranceLiters: this.config.meterVarianceToleranceLiters(depotId),
      });
      rows.push({
        day: reading.date,
        meterLiters: result.meterLiters,
        soldLiters: result.soldLiters,
        varianceLiters: result.varianceLiters,
        varianceGallons: result.varianceGallons,
        roYieldPct: result.roYieldPct,
      });
    }
    return rows;
  }

  private async reconcileWith(
    depotId: string,
    date: string,
    reading: MeterReading | null,
  ): Promise<MeterReconciliation> {
    return reconcile({
      depotId,
      date,
      reading,
      totals: await this.soldTotals(depotId, date),
      referenceVolumeMl: this.config.meterReferenceVolumeMl(depotId),
      toleranceLiters: this.config.meterVarianceToleranceLiters(depotId),
    });
  }

  /**
   * The sales side of one UTC day, from the same rows `depotDaily` reads.
   * CANCELLED orders are excluded there and here.
   */
  private async soldTotals(depotId: string, date: string): Promise<SoldTotals> {
    const from = new Date(`${date}T00:00:00.000Z`);
    const to = new Date(from.getTime() + DAY_MS);
    const rows = await this.orders.ordersForDepot(depotId, { from, to });
    const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
    const { soldLiters, unmeasuredLines } = sumSoldLiters(live.flatMap((r) => r.items));
    return {
      soldLiters,
      unmeasuredLines,
      gallonsDelivered: live
        .filter((r) => isDelivered(r.status))
        .reduce((s, r) => s + gallonQty(r), 0),
      revenueIdr: Math.round(live.reduce((s, r) => s + r.total, 0)),
    };
  }

  /**
   * One alert per depot-day. `alertedAt` is the guard: an operator who corrects a
   * mistyped dial and saves again must not fire a second alert for the same day.
   * Fails OPEN like every other notification here — a reading is never rejected
   * because its alert could not be delivered.
   */
  private async maybeAlert(
    result: MeterReconciliation,
    reading: MeterReading,
    authorization: string,
  ): Promise<void> {
    if (!result.overTolerance || reading.alertedAt !== null) {
      return;
    }
    const phone = this.config.alertPhone;
    if (!phone) {
      this.logger.debug(`Meter variance alert skipped for ${reading.depotId} (alerting disabled)`);
      return;
    }
    try {
      await this.notifications.notify(
        'METER_VARIANCE',
        phone,
        {
          depot: reading.depotId,
          date: reading.date,
          variance: String(result.varianceLiters),
          gallons: String(result.varianceGallons),
        },
        null,
        authorization,
      );
      await this.readings.markAlerted(reading.depotId, reading.date);
    } catch (error) {
      this.logger.warn(`Meter variance alert skipped: ${(error as Error).message}`);
    }
  }
}
