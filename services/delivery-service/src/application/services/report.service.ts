import { Inject, Injectable } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { onTimeOf } from '../../domain/sla';
import { DeliveryRepository, ReportRange } from '../ports/delivery.repository';
import { RatingPort } from '../ports/rating.port';
import { SettlementRepository } from '../ports/settlement.repository';
import { DELIVERY_TOKENS } from '../tokens';

export const THRESHOLD_NOTE =
  'thresholdMinutes grades only deliveries completed before the on-time status was stored; ' +
  'a stored status is never re-graded.';

export interface SlaReport {
  from: string | null;
  to: string | null;
  thresholdMinutes: number;
  /** Delivered rows whose stored on-time status was used as is (threshold ignored for them). */
  storedVerdicts: number;
  thresholdNote: string;
  totalDelivered: number;
  onTime: number;
  breached: number;
  /** onTime / totalDelivered, 0..1; null when nothing was delivered (never 0%). */
  slaRate: number | null;
  /** Mean delivery minutes rounded to 1 decimal; null when nothing was delivered. */
  avgMinutes: number | null;
  /** Median delivery minutes, 1 decimal; null when nothing was delivered. One very old delivery
   * moves the mean by thousands of minutes and the median not at all, so dashboards show this. */
  medianMinutes: number | null;
  failedCount: number;
}

export interface DepotSlaRow {
  depotId: string;
  totalDelivered: number;
  onTime: number;
  breached: number;
  slaRate: number | null;
  avgMinutes: number | null;
  medianMinutes: number | null;
  storedVerdicts: number;
}

export interface DepotSlaReport {
  from: string | null;
  to: string | null;
  thresholdMinutes: number;
  thresholdNote: string;
  depots: DepotSlaRow[];
}

export interface DepotTeamReport {
  from: string;
  to: string;
  couriers: {
    driverId: string;
    delivered: number;
    onTimeRate: number;
    failed: number;
    rating: number | null;
  }[];
  operators: {
    operatorId: string;
    verifiedSettlements: number;
    varianceIdr: number;
  }[];
}

/** Delivery SLA report over the delivery book (M6, operational dashboard). */
@Injectable()
export class ReportService {
  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.SettlementRepository)
    private readonly settlements: SettlementRepository,
    @Inject(DELIVERY_TOKENS.Rating) private readonly rating: RatingPort,
    private readonly config: DeliveryConfigService,
  ) {}

  async sla(
    range: ReportRange,
    thresholdMinutes?: number,
    depotIds?: string[],
  ): Promise<SlaReport> {
    // Network/franchise-wide roll-up over `depotIds` (or all depots when undefined) —
    // no single depot to resolve a per-depot override against, so this reads the
    // global tunable.
    const threshold = thresholdMinutes ?? this.config.slaMinutes();
    const s = await this.deliveries.slaStats(range, threshold, depotIds);
    return {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
      thresholdMinutes: threshold,
      storedVerdicts: s.storedVerdicts,
      thresholdNote: THRESHOLD_NOTE,
      totalDelivered: s.totalDelivered,
      onTime: s.onTime,
      breached: s.breached,
      slaRate: s.totalDelivered === 0 ? null : s.onTime / s.totalDelivered,
      avgMinutes:
        s.totalDelivered === 0 ? null : Math.round((s.sumMinutes / s.totalDelivered) * 10) / 10,
      medianMinutes: s.medianMinutes == null ? null : Math.round(s.medianMinutes * 10) / 10,
      failedCount: s.failedCount,
    };
  }

  /** Same on-time SLA computation as `sla`, but grouped per depot (HQ network roll-up). */
  async slaByDepot(
    range: ReportRange,
    thresholdMinutes?: number,
    depotIds?: readonly string[],
  ): Promise<DepotSlaReport> {
    // Same network-wide breakdown as `sla` — one threshold column across every
    // depot row, so the global tunable applies here too (see comment above).
    const threshold = thresholdMinutes ?? this.config.slaMinutes();
    const stats = await this.deliveries.slaStatsByDepot(range, threshold, depotIds);
    return {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
      thresholdMinutes: threshold,
      thresholdNote: THRESHOLD_NOTE,
      depots: stats.map((s) => ({
        depotId: s.depotId,
        storedVerdicts: s.storedVerdicts,
        totalDelivered: s.totalDelivered,
        onTime: s.onTime,
        breached: s.breached,
        slaRate: s.totalDelivered === 0 ? null : s.onTime / s.totalDelivered,
        avgMinutes:
          s.totalDelivered === 0 ? null : Math.round((s.sumMinutes / s.totalDelivered) * 10) / 10,
        medianMinutes: s.medianMinutes == null ? null : Math.round(s.medianMinutes * 10) / 10,
      })),
    };
  }

  async depotTeam(depotId: string, from: Date, to: Date): Promise<DepotTeamReport> {
    const [activity, operators] = await Promise.all([
      this.deliveries.depotCourierActivityInWindow(depotId, from, to),
      this.settlements.verifiedByOperatorInWindow(depotId, from, to),
    ]);
    const threshold = this.config.slaMinutes(depotId);
    // ponytail: one existing batch-rating call per courier; depot teams are small. Add a
    // depot-wide order-service contract only if this becomes a measured latency bottleneck.
    const couriers = await Promise.all(
      activity.map(async (row) => {
        const rating = await this.rating.avgRating(
          row.delivered.map((delivery) => delivery.orderId),
        );
        const onTime = row.delivered.filter((delivery) => onTimeOf(delivery, threshold)).length;
        return {
          driverId: row.driverId,
          delivered: row.delivered.length,
          onTimeRate: row.delivered.length === 0 ? 0 : onTime / row.delivered.length,
          failed: row.failed,
          rating: rating.average === null ? null : Math.round(rating.average * 10) / 10,
        };
      }),
    );
    couriers.sort((a, b) => b.delivered - a.delivered || b.onTimeRate - a.onTimeRate);
    operators.sort((a, b) => b.verifiedSettlements - a.verifiedSettlements);
    return { from: from.toISOString(), to: to.toISOString(), couriers, operators };
  }
}
