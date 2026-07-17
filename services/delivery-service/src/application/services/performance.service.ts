import { Inject, Injectable } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { dayIndex, previousWeek, weekWindow, WeekWindow } from '../../domain/courier-performance';
import { DeliveredRow, DeliveryRepository } from '../ports/delivery.repository';
import { RatingPort } from '../ports/rating.port';
import { DELIVERY_TOKENS } from '../tokens';

export interface CourierPerformance {
  /** Echoed WIB week start (YYYY-MM-DD). */
  weekStart: string;
  delivered: number;
  /** Deliveries in the prior week — for the week-over-week delta. */
  deliveredPrev: number;
  /** 7 counts, index 0 = the week's first WIB day (Mon..Sun). */
  perDay: number[];
  /** On-time (within SLA) deliveries this week. */
  onTime: number;
  /** onTime / delivered, 0..1; 0 when nothing delivered. */
  onTimeRate: number;
  failed: number;
  /** Mean rating this week, or null when no delivered order was reviewed. */
  rating: number | null;
  ratingPrev: number | null;
  /** 1-based rank among the depot's couriers by delivered count; null with no depot. */
  rank: number | null;
  /** Couriers at the depot with ≥1 delivery this week (the rank denominator). */
  depotCouriers: number;
  target: number;
  targetMet: boolean;
}

/** Weekly courier performance roll-up (design 4c) — local delivery data + rating batch. */
@Injectable()
export class PerformanceService {
  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.Rating) private readonly rating: RatingPort,
    private readonly config: DeliveryConfigService,
  ) {}

  async weekly(
    driverId: string,
    weekStartIso: string,
    depotId?: string,
  ): Promise<CourierPerformance> {
    const week = weekWindow(weekStartIso);
    const prev = previousWeek(week);
    const sla = this.config.slaMinutes;

    const [rows, prevRows, failed, depotCounts] = await Promise.all([
      this.deliveries.driverDeliveredInWindow(driverId, week.from, week.to),
      this.deliveries.driverDeliveredInWindow(driverId, prev.from, prev.to),
      this.deliveries.driverFailedCountInWindow(driverId, week.from, week.to),
      depotId
        ? this.deliveries.depotDeliveredCountsInWindow(depotId, week.from, week.to)
        : Promise.resolve([]),
    ]);

    const [rating, ratingPrev] = await Promise.all([
      this.rating.avgRating(rows.map((r) => r.orderId)),
      this.rating.avgRating(prevRows.map((r) => r.orderId)),
    ]);

    const perDay = this.bucket(rows, week);
    const onTime = rows.filter(
      (r) => (r.deliveredAt.getTime() - r.assignedAt.getTime()) / 60000 <= sla,
    ).length;
    const delivered = rows.length;

    // Rank = 1 + couriers who delivered strictly more. The caller's own count comes
    // from `delivered` (0 if they're absent from the leaderboard).
    const rank =
      depotId === undefined
        ? null
        : 1 + depotCounts.filter((c) => c.count > delivered).length;
    const target = this.config.courierWeeklyTarget;

    return {
      weekStart: weekStartIso,
      delivered,
      deliveredPrev: prevRows.length,
      perDay,
      onTime,
      onTimeRate: delivered === 0 ? 0 : onTime / delivered,
      failed,
      rating: round1(rating.average),
      ratingPrev: round1(ratingPrev.average),
      rank,
      depotCouriers: depotCounts.length,
      target,
      targetMet: delivered >= target,
    };
  }

  private bucket(rows: DeliveredRow[], week: WeekWindow): number[] {
    const perDay = [0, 0, 0, 0, 0, 0, 0];
    for (const r of rows) {
      perDay[dayIndex(r.deliveredAt, week.from)] += 1;
    }
    return perDay;
  }
}

function round1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}
