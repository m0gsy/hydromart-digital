import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { CrmConfigService } from '../../config/crm-config.service';
import { NotificationEvent } from '../../domain/notification-event';
import { isSalesReportRole, weekLabel } from '../../domain/sales-weekly';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { LegalEntityAudiencePort } from '../ports/legal-entity-audience.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface SalesWeeklyResult {
  weekStart: string;
  legalEntities: number;
  /** Ids that are not a legal entity: nothing was sent for them. */
  unknownEntities: number;
  /** Legal entities switched off: nothing was sent for them either. */
  inactiveEntities: number;
  recipients: number;
  notified: number;
  whatsapp: 'pending';
}

/**
 * AI-26: n8n says "the weekly Sales report of these legal entities is ready", by id only. Per
 * entity, hydromart tells every active account whose role is MARKETING, DIREKTUR or holds
 * `prospectSettings` AND is granted that entity in the AI web. The text and the link are ours.
 */
@Injectable()
export class SalesWeeklyService {
  private readonly logger = new Logger(SalesWeeklyService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.LegalEntityAudience) private readonly entities: LegalEntityAudiencePort,
  ) {}

  /** THROWS 503 when something could not be read or a recipient not filed; the same retry finishes the rest. */
  async run(eventId: string, weekStart: string, legalEntityIds: readonly string[]): Promise<SalesWeeklyResult> {
    const origin = this.config.aiWebUrl;
    if (!/^https:\/\/[^/\s]+$/.test(origin)) {
      throw new ServiceUnavailableException('AI_WEB_URL is not set to the AI web origin');
    }
    let unknownEntities = 0;
    let inactiveEntities = 0;
    let recipients = 0;
    let notified = 0;
    let failed = 0;
    // ponytail: sequential, one directory read per entity and one write per recipient: 50 entities of a
    // few people each fit a minute or two. Callers allow a long HTTP timeout; a retry is safe (deduped).
    for (const entityId of legalEntityIds) {
      const audience = await this.read(`legal entity ${entityId}`, () => this.entities.audienceOf(entityId));
      if (!audience) {
        unknownEntities += 1;
        continue;
      }
      if (!audience.active) {
        inactiveEntities += 1;
        continue;
      }
      const roles = [...new Set(audience.aiReadRoles.filter(isSalesReportRole))];
      const ids = [...new Set(await this.read('recipients', () => this.directory.staffIdsByRoles(roles)))];
      const held = await this.read('recipients', () => this.directory.rolesOf(ids));
      const people = ids.filter((id) => roles.includes(held.get(id) ?? ''));
      recipients += people.length;
      const vars = {
        week: weekLabel(weekStart),
        entity: audience.name,
        link: `${origin}/calon-mitra/laporan?minggu=${weekStart}&be=${entityId}`,
      };
      for (const id of people) {
        try {
          await this.notifications.notify(
            NotificationEvent.SALES_WEEKLY_REPORT,
            '',
            vars,
            id,
            null,
            `${eventId}:${entityId}:${id}`,
          );
          notified += 1;
        } catch (e) {
          failed += 1;
          this.logger.warn(`sales weekly notice for ${id} failed: ${(e as Error).message}`);
        }
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry the same eventId`);
    }
    return { weekStart, legalEntities: legalEntityIds.length, unknownEntities, inactiveEntities, recipients, notified, whatsapp: 'pending' };
  }

  private read<T>(what: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((e: Error) => {
      this.logger.warn(`sales weekly: ${what} unreadable: ${e.message}`);
      throw new ServiceUnavailableException(`The ${what} could not be read; retry the same eventId`);
    });
  }
}
