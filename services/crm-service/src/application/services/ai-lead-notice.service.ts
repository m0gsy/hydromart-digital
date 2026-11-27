import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { CrmConfigService } from '../../config/crm-config.service';
import { AI_LEAD_EVENT_OF, AiLeadNoticeKind, isLeadRole } from '../../domain/ai-lead-notice';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { LegalEntityAudiencePort } from '../ports/legal-entity-audience.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface AiLeadNoticeResult {
  /** The legal entity is not one, or is switched off: nothing was sent. */
  skipped: boolean;
  recipients: number;
  notified: number;
  whatsapp: 'pending';
}

/**
 * AI-14: n8n relays "a calon mitra filled the public form" (NEW) or "nobody called them in time"
 * (REMIND / ESCALATE), by ids and place names only. hydromart picks the recipients and writes the
 * words: per legal entity, the staff whose role may read that entity's CRM in the AI web and works
 * the kind's audience. REMIND with a person on the lead goes to that person only.
 */
@Injectable()
export class AiLeadNoticeService {
  private readonly logger = new Logger(AiLeadNoticeService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.LegalEntityAudience) private readonly entities: LegalEntityAudiencePort,
  ) {}

  /** THROWS 503 when something could not be read or a recipient not filed; the same retry finishes the rest. */
  async run(dto: {
    eventId: string;
    kind: AiLeadNoticeKind;
    prospectId: string;
    legalEntityId: string;
    city: string;
    province: string;
    picAccountId?: string;
  }): Promise<AiLeadNoticeResult> {
    const origin = this.config.aiWebUrl;
    if (!/^https:\/\/[^/\s]+$/.test(origin)) {
      throw new ServiceUnavailableException('AI_WEB_URL is not set to the AI web origin');
    }
    const audience = await this.read('legal entity', () => this.entities.audienceOf(dto.legalEntityId));
    if (!audience || !audience.active) return { skipped: true, recipients: 0, notified: 0, whatsapp: 'pending' };
    const roles = [...new Set(audience.aiReadRoles.filter((r) => isLeadRole(dto.kind, r)))];
    const ids = [...new Set(await this.read('recipients', () => this.directory.staffIdsByRoles(roles)))];
    const held = await this.read('recipients', () => this.directory.rolesOf(ids));
    let people = ids.filter((id) => roles.includes(held.get(id) ?? ''));
    // The person who took the lead is reminded alone; if they left or lost the role, the team is.
    if (dto.kind === 'REMIND' && dto.picAccountId && people.includes(dto.picAccountId)) people = [dto.picAccountId];
    const vars = {
      city: dto.city,
      province: dto.province,
      link: dto.kind === 'NEW' ? `${origin}/calon-mitra?antrean=1` : `${origin}/calon-mitra/${dto.prospectId}`,
    };
    let notified = 0;
    let failed = 0;
    for (const id of people) {
      try {
        await this.notifications.notify(AI_LEAD_EVENT_OF[dto.kind], '', vars, id, null, `${dto.eventId}:${dto.legalEntityId}:${id}`);
        notified += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`ai lead notice for ${id} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry the same eventId`);
    }
    return { skipped: false, recipients: people.length, notified, whatsapp: 'pending' };
  }

  private read<T>(what: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((e: Error) => {
      this.logger.warn(`ai lead notice: ${what} unreadable: ${e.message}`);
      throw new ServiceUnavailableException(`The ${what} could not be read; retry the same eventId`);
    });
  }
}
