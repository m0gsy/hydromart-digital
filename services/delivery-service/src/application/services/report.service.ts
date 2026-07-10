import { Inject, Injectable } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { DeliveryRepository, ReportRange } from '../ports/delivery.repository';
import { DELIVERY_TOKENS } from '../tokens';

export interface SlaReport {
  from: string | null;
  to: string | null;
  thresholdMinutes: number;
  totalDelivered: number;
  onTime: number;
  breached: number;
  /** onTime / totalDelivered, 0..1; 0 when nothing was delivered. */
  slaRate: number;
  /** Mean delivery minutes rounded to 1 decimal; null when nothing was delivered. */
  avgMinutes: number | null;
  failedCount: number;
}

/** Delivery SLA report over the delivery book (M6, operational dashboard). */
@Injectable()
export class ReportService {
  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    private readonly config: DeliveryConfigService,
  ) {}

  async sla(range: ReportRange, thresholdMinutes?: number): Promise<SlaReport> {
    const threshold = thresholdMinutes ?? this.config.slaMinutes;
    const s = await this.deliveries.slaStats(range, threshold);
    return {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
      thresholdMinutes: threshold,
      totalDelivered: s.totalDelivered,
      onTime: s.onTime,
      breached: s.breached,
      slaRate: s.totalDelivered === 0 ? 0 : s.onTime / s.totalDelivered,
      avgMinutes:
        s.totalDelivered === 0 ? null : Math.round((s.sumMinutes / s.totalDelivered) * 10) / 10,
      failedCount: s.failedCount,
    };
  }
}
