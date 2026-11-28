import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { rolesFor } from '@hydromart/access';

import { CrmConfigService } from '../../config/crm-config.service';
import { AI_CS_EVENT_OF, AiCsNoticeKind, isCsRecipient } from '../../domain/ai-cs-notice';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface AiCsNoticeResult {
  recipients: number;
  notified: number;
  whatsapp: 'pending';
}

/**
 * AI-11: the AI web's CS inbox (WhatsApp number 2) relays "a chat was handed to CS" (NEW) or "it waits
 * too long" (REMIND / ESCALATE) by a conversation id and a kind only: no customer name, number or
 * message text ever passes, and none is written. hydromart picks the recipients (aiCsReply holders;
 * aiCsManage holders for ESCALATE) and writes the words and the link.
 */
@Injectable()
export class AiCsNoticeService {
  private readonly logger = new Logger(AiCsNoticeService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
  ) {}

  /** THROWS 503 when the directory cannot be read or a recipient could not be filed; the same retry finishes the rest. */
  async run(dto: { eventId: string; kind: AiCsNoticeKind; conversationId: string }): Promise<AiCsNoticeResult> {
    const origin = this.config.aiWebUrl;
    if (!/^https:\/\/[^/\s]+$/.test(origin)) {
      throw new ServiceUnavailableException('AI_WEB_URL is not set to the AI web origin');
    }
    const people = await this.recipients(dto.kind);
    const vars = { link: `${origin}/cs/${dto.conversationId}` };
    let notified = 0;
    let failed = 0;
    for (const id of people) {
      try {
        await this.notifications.notify(AI_CS_EVENT_OF[dto.kind], '', vars, id, null, `${dto.eventId}:${id}`);
        notified += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`ai cs notice for ${id} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry the same eventId`);
    }
    return { recipients: people.length, notified, whatsapp: 'pending' };
  }

  /** Active accounts whose role holds the kind's capability (read again per account, so a moved person drops out). */
  private async recipients(kind: AiCsNoticeKind): Promise<string[]> {
    try {
      const roles = [...rolesFor(kind === 'ESCALATE' ? 'aiCsManage' : 'aiCsReply')];
      const ids = [...new Set(await this.directory.staffIdsByRoles(roles))];
      const held = await this.directory.rolesOf(ids);
      return ids.filter((id) => {
        const role = held.get(id);
        return role !== undefined && isCsRecipient(kind, role);
      });
    } catch (e) {
      this.logger.warn(`ai cs notice: recipients unreadable: ${(e as Error).message}`);
      throw new ServiceUnavailableException('The recipients could not be read; retry the same eventId');
    }
  }
}
