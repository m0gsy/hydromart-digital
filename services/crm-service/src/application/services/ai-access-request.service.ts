import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { can, rolesFor } from '@hydromart/access';

import { AI_ACCESS_CAPABILITY, accessRequestText } from '../../domain/ai-access-request';
import { NotificationEvent } from '../../domain/notification-event';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { LegalEntityNamesPort } from '../ports/legal-entity-names.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface AiAccessRequestResult {
  recipients: number;
  notified: number;
  /** Set when the hourly cap was reached: nothing was sent, and it is not worth retrying. */
  capped?: true;
  whatsapp: 'pending';
}

/** Rolling hour: at most this many distinct requests per requester, and this many overall. */
const CAP_WINDOW_MS = 3_600_000;
const CAP_PER_REQUESTER = 3;
const CAP_OVERALL = 30;
// The row key is `<eventId>:<requesterId>:<recipientId>`, which is how the cap counts requests.
const KEY = /^(ai-access-request:[0-9a-f-]{36}):([0-9a-f-]{36}):/;

/**
 * AI-7c: someone in the AI web pressed "Minta akses". n8n only carries ids; the requester's
 * name and role, the entities' names, the recipients and the words are all hydromart's. One
 * notification per person who can grant AI access (bell and push, email through the same path
 * as every staff kind); WhatsApp is reported `pending` until Meta is ready and never faked.
 */
@Injectable()
export class AiAccessRequestService {
  private readonly logger = new Logger(AiAccessRequestService.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.LegalEntityNames) private readonly entities: LegalEntityNamesPort,
  ) {}

  /**
   * `eventId` is the dedupe base: a recipient who already has the row is not sent it again.
   * Nothing is sent (notified 0, never an error) for a requester who does not exist or who can
   * already grant access. THROWS 503 when the directory or the entity names cannot be read, or a
   * recipient could not be filed; rows already filed stay, and the same retry finishes the rest.
   */
  async run(
    eventId: string,
    requesterAccountId: string,
    legalEntityIds: readonly string[] = [],
    group?: string,
  ): Promise<AiAccessRequestResult> {
    const unreadable = (what: string) => (e: Error) => {
      this.logger.warn(`ai access request: ${what} unreadable: ${e.message}`);
      throw new ServiceUnavailableException(
        `The ${what} could not be read; retry the same eventId`,
      );
    };
    const requester = await this.directory
      .profileOf(requesterAccountId)
      .catch(unreadable('requester'));
    if (!requester || can(AI_ACCESS_CAPABILITY, requester.role)) {
      return { recipients: 0, notified: 0, whatsapp: 'pending' };
    }
    const recipients = await this.recipients().catch(unreadable('recipients'));
    if (await this.capped(eventId, requesterAccountId, unreadable('recent requests'))) {
      this.logger.warn(`ai access request ${eventId} from ${requesterAccountId} capped`);
      return { recipients: recipients.length, notified: 0, capped: true, whatsapp: 'pending' };
    }
    const names =
      legalEntityIds.length > 0
        ? await this.entities.namesOf(legalEntityIds).catch(unreadable('legal entities'))
        : [];
    const vars = accessRequestText(requester, names, group);
    let notified = 0;
    let failed = 0;
    for (const id of recipients) {
      try {
        await this.notifications.notify(
          NotificationEvent.AI_ACCESS_REQUESTED,
          '',
          vars,
          id,
          null,
          `${eventId}:${requesterAccountId}:${id}`,
        );
        notified += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`ai access request for ${id} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(
        `${failed} recipient(s) could not be told; retry the same eventId`,
      );
    }
    return { recipients: recipients.length, notified, whatsapp: 'pending' };
  }

  /**
   * Whether this would be one request too many in the last hour. An eventId already filed (a retry
   * finishing its recipients) is not a new request. Not atomic: two calls at the same instant can both
   * pass, so the cap holds to within a call or two, which is all it is for.
   */
  private async capped(
    eventId: string,
    requesterId: string,
    unreadable: (e: Error) => never,
  ): Promise<boolean> {
    const keys = await this.notifications
      .recentDedupeKeys(NotificationEvent.AI_ACCESS_REQUESTED, new Date(Date.now() - CAP_WINDOW_MS))
      .catch(unreadable);
    const requests = new Map<string, string>();
    for (const key of keys) {
      const m = KEY.exec(key);
      if (m) requests.set(m[1]!, m[2]!);
    }
    if (requests.has(eventId)) return false;
    const mine = [...requests.values()].filter((r) => r === requesterId).length;
    return mine >= CAP_PER_REQUESTER || requests.size >= CAP_OVERALL;
  }

  /** Active accounts whose role holds the capability that grants AI access. */
  private async recipients(): Promise<string[]> {
    // The roles come from the capability table, so a role gaining it is picked up with no change here.
    const ids = await this.directory.staffIdsByRoles(rolesFor(AI_ACCESS_CAPABILITY));
    const roles = await this.directory.rolesOf(ids);
    return ids.filter((id) => {
      const role = roles.get(id);
      return role !== undefined && can(AI_ACCESS_CAPABILITY, role);
    });
  }
}
