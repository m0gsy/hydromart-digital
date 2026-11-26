import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { NotificationEvent } from '../../domain/notification-event';
import { DepotAudienceService } from './depot-audience.service';
import { NotificationService } from './notification.service';

export interface VisitNotice {
  kind: 'FINDING' | 'OVERDUE';
  depotId: string;
  depotName: string;
  visitId?: string;
  dateKey: string;
  items: string[];
}

/** Items named in one row (the rest is counted); the tap opens the visit or the depot's list. */
const LISTED_ITEMS = 5;
const CONCURRENCY = 5;

/**
 * HD-15B (owner decision 19): what a supervisor visit found, and the follow-ups left open past
 * their deadline, reach the depot's Kepala, the supervisors over it and HQ Operasional: bell, push
 * and email through notify(). One row per recipient. The dedupe key is the memory, so a retry of
 * the same notice files nothing twice: a FINDING once per (visit, recipient), an OVERDUE once per
 * (depot, WIB day, recipient); depot-service decides how often a day is allowed (every 3 days).
 */
@Injectable()
export class VisitNoticeService {
  private readonly logger = new Logger(VisitNoticeService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly audience: DepotAudienceService,
  ) {}

  /** THROWS 503 when the recipients cannot be read or one could not be filed; filed rows stay, retry is safe. */
  async run(notice: VisitNotice): Promise<{ recipients: number; notified: number }> {
    if (notice.items.length === 0) return { recipients: 0, notified: 0 };
    if (notice.kind === 'FINDING' && !notice.visitId) {
      throw new BadRequestException('A finding notice names its visit');
    }
    const recipients = await this.audience.everyone(notice.depotId).catch((e: Error) => {
      this.logger.warn(`visit notice: recipients unreadable: ${e.message}`);
      throw new ServiceUnavailableException('The recipients could not be read; retry');
    });
    const event =
      notice.kind === 'FINDING' ? NotificationEvent.VISIT_FINDING : NotificationEvent.FOLLOW_UP_OVERDUE;
    const listed = notice.items.slice(0, LISTED_ITEMS).join('; ');
    const rest = notice.items.length - LISTED_ITEMS;
    const vars: Record<string, string> = {
      depot: notice.depotName,
      items: rest > 0 ? `${listed}; dan ${rest} lainnya` : listed,
      depotId: notice.depotId,
      ...(notice.visitId ? { visitId: notice.visitId } : {}),
    };
    const keyOf = (recipient: string): string =>
      notice.kind === 'FINDING'
        ? `visit-finding:${notice.visitId}:${recipient}`
        : `follow-up-overdue:${notice.depotId}:${notice.dateKey}:${recipient}`;

    let notified = 0;
    let failed = 0;
    for (let at = 0; at < recipients.length; at += CONCURRENCY) {
      await Promise.all(
        recipients.slice(at, at + CONCURRENCY).map(async (recipient) => {
          try {
            const filed = await this.notifications.notifyOnce(event, '', vars, recipient, null, keyOf(recipient));
            if (filed.created) notified += 1;
          } catch (e) {
            failed += 1;
            this.logger.warn(`visit notice for ${recipient} failed: ${(e as Error).message}`);
          }
        }),
      );
    }
    if (failed > 0) throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    return { recipients: recipients.length, notified };
  }
}
