import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { FailureReasonCode } from '../../domain/failure-reason';
import { AiDeliveryRepository, AiSpan } from '../ports/ai-delivery.repository';
import { DELIVERY_TOKENS } from '../tokens';

/** Most depots one AI read may ask about; past it is 422, never a silent cut. */
export const MAX_AI_DEPOTS = 100;

export interface AiDeliverySummary {
  delivered: number;
  onTime: number;
  /** delivered with a stored verdict; the rest were graded with `thresholdMinutes`. */
  storedVerdicts: number;
  /** The one threshold old rows were graded with, or null when depots in scope have different ones. */
  thresholdMinutes: number | null;
  medianMinutes: number | null;
  couriers: number;
  failed: number;
  noShow: number;
  /** Failed for a reason a courier typed. Never returned as text: it can name a person. */
  otherFailed: number;
  rescheduled: number;
  /** Failed by fixed reason (K-04 breakdown); the codes are fixed, never courier text. */
  byReason: Record<FailureReasonCode, number>;
}

/**
 * HD-6 H3: delivered, on-time, median minutes, failed (with the one fixed reason) and rescheduled
 * deliveries for the AI read API, over the spans the caller may read. Spans are checked, not trusted.
 */
@Injectable()
export class AiDeliverySummaryService {
  constructor(
    @Inject(DELIVERY_TOKENS.AiDeliveryRepository) private readonly repo: AiDeliveryRepository,
    private readonly config: DeliveryConfigService,
  ) {}

  async summary(spans: readonly AiSpan[]): Promise<AiDeliverySummary> {
    if (new Set(spans.map((s) => s.depotId)).size > MAX_AI_DEPOTS) {
      throw new UnprocessableEntityException(`Paling banyak ${MAX_AI_DEPOTS} depot per baca.`);
    }
    const byDepot = new Map<string, AiSpan[]>();
    for (const s of spans) byDepot.set(s.depotId, [...(byDepot.get(s.depotId) ?? []), s]);
    for (const list of byDepot.values()) {
      const sorted = [...list].sort((a, b) => a.from.getTime() - b.from.getTime());
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from < sorted[i - 1].to) {
          throw new UnprocessableEntityException('Rentang satu depot tidak boleh tumpang tindih.');
        }
      }
    }
    // Rows completed before the verdict was stored are graded with their depot's threshold: the depot setting, else the
    // network one (what /hq/sla-policy shows and saves, else the env default).
    const graded = spans.map((s) => ({ ...s, thresholdMinutes: this.config.slaMinutes(s.depotId) }));
    const distinct = new Set(graded.map((g) => g.thresholdMinutes));
    const thresholdMinutes = distinct.size === 1 ? [...distinct][0] : null;
    const [d, f] = await Promise.all([this.repo.deliveredStats(graded), this.repo.failedStats(spans)]);
    return {
      delivered: d.delivered,
      onTime: d.onTime,
      storedVerdicts: d.storedVerdicts,
      thresholdMinutes,
      medianMinutes: d.medianMinutes === null ? null : Math.round(d.medianMinutes * 10) / 10,
      couriers: d.couriers,
      failed: f.failed,
      noShow: f.noShow,
      otherFailed: f.failed - f.noShow,
      rescheduled: f.rescheduled,
      byReason: f.byReason,
    };
  }
}
