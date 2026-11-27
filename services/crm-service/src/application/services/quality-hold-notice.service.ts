import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { ENDED_MAX_AGE_MS, ENDED_MAX_FUTURE_MS, QUALITY_HOLD_MARKETING_ROLE, QualityHoldStatus, qualityHoldText } from '../../domain/quality-hold-notice';
import { NotificationEvent } from '../../domain/notification-event';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { HeldDepotsPort } from '../ports/held-depots.port';
import { CRM_TOKENS } from '../tokens';
import { DepotAudienceService } from './depot-audience.service';
import { NotificationService } from './notification.service';

export interface QualityHoldNoticeResult {
  notified: number;
  /** True when the live state no longer agrees with the event: nothing was sent and a retry would change nothing. */
  stale?: true;
}

/**
 * HD-14: depot-service started or ended a quality hold; n8n relays the event. Nothing in the body is
 * trusted beyond the depot id: the depot's CURRENT hold state is read again, and only an event that
 * agrees with it is told (a late ACTIVE after the hold ended, or an ENDED over a newer hold, is stale).
 * Staff only: the depot's Kepala, the supervisors over it, HQ Operasional and Marketing, once each.
 */
@Injectable()
export class QualityHoldNoticeService {
  private readonly logger = new Logger(QualityHoldNoticeService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly audience: DepotAudienceService,
    @Inject(CRM_TOKENS.HeldDepots) private readonly depots: HeldDepotsPort,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
  ) {}

  /** THROWS 503 when the depot directory or recipients cannot be read or one could not be filed; a retry finishes the rest. */
  async run(depotId: string, status: QualityHoldStatus, changedAt: string): Promise<QualityHoldNoticeResult> {
    const unreadable = (what: string) => (e: Error) => {
      this.logger.warn(`quality hold notice: ${what} unreadable: ${e.message}`);
      throw new ServiceUnavailableException(`The ${what} could not be read; retry`);
    };
    const depot = (await this.depots.depotsById().catch(unreadable('depot directory'))).get(depotId);
    if (!depot) {
      this.logger.warn(`quality hold notice: depot ${depotId} not in the directory; answered stale`);
      return { notified: 0, stale: true };
    }
    if (depot.held !== (status === 'ACTIVE')) return { notified: 0, stale: true };
    // changedAt is the caller's word. ACTIVE: the hold's own start, from the directory, is the time shown
    // and keyed (a replay cannot notify twice). ENDED: no end stamp exists, so the body's time is bounded.
    let at = changedAt;
    if (status === 'ACTIVE') {
      at = depot.since ?? changedAt;
    } else {
      const age = Date.now() - new Date(changedAt).getTime();
      if (age < -ENDED_MAX_FUTURE_MS || age > ENDED_MAX_AGE_MS) {
        throw new BadRequestException('changedAt of an ENDED event must be within the last 24 hours');
      }
    }

    const [staff, marketing] = await Promise.all([
      this.audience.everyone(depotId),
      this.marketing(),
    ]).catch(unreadable('recipients'));
    const text = qualityHoldText(status, depot.name, new Date(at));
    let notified = 0;
    let failed = 0;
    for (const id of new Set([...staff, ...marketing])) {
      try {
        // The key is unique per row, so the recipient is part of it: a re-delivered event files nothing twice.
        const { created } = await this.notifications.notifyOnce(
          NotificationEvent.QUALITY_HOLD,
          '',
          { text, depotId },
          id,
          null,
          `quality-hold:${depotId}:${status}:${at}:${id}`,
        );
        if (created) notified += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`quality hold notice for ${id} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    return { notified };
  }

  /** Active Marketing accounts, network-wide, re-checked against their current role. */
  private async marketing(): Promise<string[]> {
    const ids = await this.directory.staffIdsByRoles([QUALITY_HOLD_MARKETING_ROLE]);
    const roles = await this.directory.rolesOf(ids);
    return ids.filter((id) => roles.get(id) === QUALITY_HOLD_MARKETING_ROLE);
  }
}
