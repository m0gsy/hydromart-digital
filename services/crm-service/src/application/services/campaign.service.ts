import { Inject, Injectable, Logger } from '@nestjs/common';

import { canSend } from '../../domain/campaign-status';
import { RecipientStatus } from '../../domain/recipient-status';
import { renderTemplate } from '../../domain/template';
import {
  CampaignNotDraftError,
  CampaignNotFoundError,
  NoRecipientsError,
} from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import {
  CampaignRecord,
  CampaignRepository,
  CreateRecipientData,
} from '../ports/campaign.repository';
import { WhatsappBroadcastPort } from '../ports/whatsapp-broadcast.port';
import { CRM_TOKENS } from '../tokens';

/**
 * Broadcast-campaign use cases (PRD Module 12 FR-088/FR-094).
 *
 * SCOPE BOUNDARY (MVP): recipients are always the EXPLICIT list marketing staff supply.
 * Attribute-based segmentation (FR-087, by tier/geography) would require a cross-service
 * customer directory that no staff customer-list endpoint exposes today, so it is DEFERRED
 * — this service never queries or fabricates an audience.
 */
@Injectable()
export class CampaignService {
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @Inject(CRM_TOKENS.CampaignRepository) private readonly repo: CampaignRepository,
    @Inject(CRM_TOKENS.WhatsappBroadcast) private readonly whatsapp: WhatsappBroadcastPort,
  ) {}

  async create(
    createdBy: string,
    name: string,
    messageTemplate: string,
    recipients: CreateRecipientData[],
  ): Promise<CampaignRecord> {
    // Dedupe by phone (last wins) — a pasted list often repeats numbers, and the DB has a
    // unique(campaignId, phone) constraint that would otherwise reject the insert.
    const deduped = [...new Map(recipients.map((r) => [r.phone, r])).values()];
    if (deduped.length === 0) throw new NoRecipientsError();
    return this.repo.create({ createdBy, name, messageTemplate, recipients: deduped });
  }

  private clampPage(page = 1, limit = 20): { p: number; l: number } {
    return { p: Math.max(1, page), l: Math.min(CampaignService.MAX_LIMIT, Math.max(1, limit)) };
  }

  async list(page = 1, limit = 20): Promise<Page<CampaignRecord>> {
    const { p, l } = this.clampPage(page, limit);
    const { items, total } = await this.repo.list(p, l);
    return buildPage(items, total, p, l);
  }

  async get(id: string): Promise<CampaignRecord> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError();
    return campaign;
  }

  /**
   * Dispatch a DRAFT campaign to every PENDING recipient. Idempotent-guarded by the DRAFT
   * check — a SENT/SENDING campaign is rejected, so a send never runs twice. Each recipient
   * failure is recorded and tallied rather than aborting the broadcast.
   */
  async send(id: string): Promise<CampaignRecord> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError();
    if (!canSend(campaign.status)) throw new CampaignNotDraftError();

    await this.repo.markSending(id);

    let sentCount = 0;
    let failedCount = 0;
    const pending = campaign.recipients.filter((r) => r.status === RecipientStatus.PENDING);
    for (const recipient of pending) {
      const message = renderTemplate(campaign.messageTemplate, {
        name: recipient.name ?? undefined,
        phone: recipient.phone,
      });
      const result = await this.whatsapp.send(recipient.phone, message);
      if (result.ok) {
        sentCount += 1;
        await this.repo.recordRecipientResult(recipient.id, RecipientStatus.SENT, null, new Date());
      } else {
        failedCount += 1;
        await this.repo.recordRecipientResult(
          recipient.id,
          RecipientStatus.FAILED,
          result.error ?? 'unknown error',
          null,
        );
      }
    }

    const updated = await this.repo.finalize(id, sentCount, failedCount, new Date());
    this.logger.log(`Campaign ${id} sent: ${sentCount} delivered, ${failedCount} failed`);
    return updated;
  }
}
