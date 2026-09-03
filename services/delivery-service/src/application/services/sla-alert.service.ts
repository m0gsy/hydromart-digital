import { Inject, Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { DeliveryRepository, SlaCandidate } from '../ports/delivery.repository';
import { OpsNotifierPort } from '../ports/ops-notifier.port';
import { DELIVERY_TOKENS } from '../tokens';

export interface SlaSweepResult {
  /**
   * J7. FALSE when every alert this round failed to reach ops. HTTP 200 is a statement
   * about the transport; a sweep that tried five and delivered none is not a healthy
   * sweep, and a scheduler that cannot tell those apart reports calm during an outage.
   */
  ok: boolean;
  /** Candidates examined (past the coarse cutoff, not yet alerted). */
  checked: number;
  /** Of those, the ones actually past THEIR depot's SLA window. */
  breached: number;
  /** Of those, the ones whose alert reached ops and were stamped. */
  alerted: number;
}

/**
 * J8 — the SLA was a number in a report and nothing else.
 *
 * `ReportService.sla()` counts breaches after the fact: it can tell you 12% of yesterday
 * missed the window, and it told nobody while those twelve were still on the road and
 * still rescuable. This is the half that calls someone. It does NOT reassign the courier
 * or move the order — deciding to take work off one person and give it to another is a
 * business decision nobody has made, and a sweep is the wrong place to make it silently.
 *
 * Threshold is per-depot (`slaMinutes`), so the repository query cannot decide a breach;
 * it only narrows the set. The floor in SETTING_DEFS is what makes that coarse cutoff
 * safe: no depot can configure a window tighter than it, so nothing can breach earlier.
 */
@Injectable()
export class SlaAlertService {
  /** One tick's ceiling. A backlog bigger than this drains over the following ticks. */
  private static readonly BATCH = 200;
  /**
   * The tightest SLA any depot is allowed to configure, and therefore the earliest any
   * delivery can breach. Written here rather than read out of SETTING_DEFS at runtime so
   * this stays one number with no fallback branch; `sla-alert.service.spec` asserts the
   * two agree, which is what catches somebody lowering the setting's floor.
   */
  static readonly MIN_SLA_MINUTES = 15;
  private readonly logger = new Logger(SlaAlertService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(DELIVERY_TOKENS.OpsNotifier) private readonly ops: OpsNotifierPort,
    private readonly config: DeliveryConfigService,
  ) {}

  async sweep(now: Date = new Date()): Promise<SlaSweepResult> {
    const cutoff = new Date(now.getTime() - SlaAlertService.MIN_SLA_MINUTES * 60_000);
    const candidates = await this.deliveries.findUnalertedInFlight(cutoff, SlaAlertService.BATCH);

    let breached = 0;
    let alerted = 0;
    for (const candidate of candidates) {
      const thresholdMinutes = this.config.slaMinutes(candidate.depotId);
      const minutes = Math.floor((now.getTime() - candidate.assignedAt.getTime()) / 60_000);
      if (minutes <= thresholdMinutes) continue;
      breached++;
      if (await this.alert(candidate, minutes, thresholdMinutes)) {
        await this.deliveries.markSlaAlerted(candidate.id, now);
        alerted++;
      }
    }

    if (breached > 0) {
      this.logger.log(
        `SLA sweep: ${breached} breached, ${alerted} alerted (${candidates.length} checked)`,
      );
    }
    return { ok: breached === 0 || alerted > 0, checked: candidates.length, breached, alerted };
  }

  private async alert(
    candidate: SlaCandidate,
    minutes: number,
    thresholdMinutes: number,
  ): Promise<boolean> {
    return this.ops.slaBreached({
      orderNumber: candidate.orderNumber,
      minutes,
      thresholdMinutes,
      depotId: candidate.depotId,
    });
  }
}
