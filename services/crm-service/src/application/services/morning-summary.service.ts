import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { MORNING_SUMMARY_ROLES, summaryOf } from '../../domain/morning-summary';
import { NotificationEvent } from '../../domain/notification-event';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { PendingApprovalsPort } from '../ports/pending-approvals.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface MorningSummaryResult {
  date: string;
  recipients: number;
  notified: number;
  nothingWaiting: number;
  whatsapp: 'pending';
}

/**
 * AI-9, owner decision 24 Nov 2026: n8n only TRIGGERS the Direksi morning summary. Who gets it
 * and what it says is computed here: each recipient's queues come from dashboard-service (the
 * HD-11 rules, for that person), and the counts never pass through n8n. One notification per
 * recipient (bell and push, and email through the same path as every staff kind); WhatsApp is
 * reported `pending` until Meta is ready and is never faked.
 */
@Injectable()
export class MorningSummaryService {
  private readonly logger = new Logger(MorningSummaryService.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.PendingApprovals) private readonly pending: PendingApprovalsPort,
  ) {}

  /**
   * `eventId` is the dedupe base: a recipient who already has the day's row is not sent it again,
   * so a retry or a replay of the trigger sends nothing twice. THROWS 503 when the recipients or
   * anybody's queues could not be read; the rows already filed stay, and the same retry finishes the rest.
   */
  async run(eventId: string, date: string): Promise<MorningSummaryResult> {
    const recipients = await this.recipients().catch((e: Error) => {
      this.logger.warn(`morning summary: recipients unreadable: ${e.message}`);
      throw new ServiceUnavailableException('The recipients could not be read; retry the same eventId');
    });
    let notified = 0;
    let nothingWaiting = 0;
    let failed = 0;
    for (const [id, role] of recipients) {
      try {
        const text = summaryOf(await this.pending.forAccount(id, role));
        if (!text) {
          nothingWaiting += 1;
          continue;
        }
        await this.notifications.notify(
          NotificationEvent.MORNING_SUMMARY,
          '',
          { summary: text.summary, oldest: text.oldest, ...(text.href ? { href: text.href } : {}) },
          id,
          null,
          `${eventId}:${id}`,
        );
        notified += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`morning summary for ${id} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be summarised; retry the same eventId`);
    }
    return { date, recipients: recipients.length, notified, nothingWaiting, whatsapp: 'pending' };
  }

  /** Active accounts holding a recipient role, with the role each holds. */
  private async recipients(): Promise<Array<[string, string]>> {
    const ids = await this.directory.staffIdsByRoles(MORNING_SUMMARY_ROLES);
    const roles = await this.directory.rolesOf(ids);
    return ids.flatMap((id): Array<[string, string]> => {
      const role = roles.get(id);
      return role !== undefined && MORNING_SUMMARY_ROLES.includes(role) ? [[id, role]] : [];
    });
  }
}
