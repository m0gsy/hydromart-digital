import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { can, rolesFor } from '@hydromart/access';

import { CrmConfigService } from '../../config/crm-config.service';
import { NotificationEvent } from '../../domain/notification-event';
import { AiAgentNoticeKind } from '../../domain/ai-agent-notice';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface AiAgentNoticeResult {
  recipients: number;
  notified: number;
  whatsapp: 'pending';
}

const EVENT_OF: Record<AiAgentNoticeKind, NotificationEvent> = {
  FLAG: NotificationEvent.AI_AGENT_FLAG,
  CAP_REACHED: NotificationEvent.AI_AGENT_CAP,
  STOPPED: NotificationEvent.AI_AGENT_STOPPED,
  STOPPED_ALL: NotificationEvent.AI_AGENT_STOPPED,
};

/**
 * AI-31: an AI agent of the "Tim AI" flagged something, hit its cap or was stopped. n8n carries
 * ids and a kind; the words, the link and the recipients are hydromart's: the holders of
 * `aiTeamManage` (Direksi), plus the agent's boss role when that role holds `aiTeamRead`. No amount
 * and no depot staff are told. There is no depotId: a body carrying one is read by the depot-scope guard and a machine token is refused 403.
 */
@Injectable()
export class AiAgentNoticeService {
  private readonly logger = new Logger(AiAgentNoticeService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
  ) {}

  /** THROWS 503 when the directory cannot be read or a recipient could not be filed; the same retry finishes the rest. */
  async run(dto: {
    eventId: string;
    agentId: string;
    agentName: string;
    kind: AiAgentNoticeKind;
    bossRole?: string;
  }): Promise<AiAgentNoticeResult> {
    const origin = this.config.aiWebUrl;
    if (!/^https:\/\/[^/\s]+$/.test(origin)) {
      throw new ServiceUnavailableException('AI_WEB_URL is not set to the AI web origin');
    }
    const roles = new Set(rolesFor('aiTeamManage'));
    if (dto.bossRole && can('aiTeamRead', dto.bossRole)) roles.add(dto.bossRole);
    const recipients = await this.recipients([...roles], dto.bossRole);
    const all = dto.kind === 'STOPPED_ALL';
    const vars = {
      who: all ? 'Semua agen AI' : `Agen ${dto.agentName}`,
      link: `${origin}/tim-ai${all ? '' : `/${dto.agentId}`}`,
    };
    let notified = 0;
    let failed = 0;
    for (const id of recipients) {
      try {
        await this.notifications.notify(EVENT_OF[dto.kind], '', vars, id, null, `${dto.eventId}:${id}`);
        notified += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`ai agent notice for ${id} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry the same eventId`);
    }
    return { recipients: recipients.length, notified, whatsapp: 'pending' };
  }

  /** Active accounts whose role is in `roles` (read again per account, so a moved person drops out). */
  private async recipients(roles: string[], boss: string | undefined): Promise<string[]> {
    try {
      const ids = await this.directory.staffIdsByRoles(roles);
      const held = await this.directory.rolesOf(ids);
      return ids.filter((id) => {
        const role = held.get(id);
        return role !== undefined && (can('aiTeamManage', role) || (role === boss && can('aiTeamRead', role)));
      });
    } catch (e) {
      this.logger.warn(`ai agent notice: recipients unreadable: ${(e as Error).message}`);
      throw new ServiceUnavailableException('The recipients could not be read; retry the same eventId');
    }
  }
}
