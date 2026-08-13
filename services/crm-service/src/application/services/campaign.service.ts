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
import {
  ActivitySegmentPort,
  hasActivityConditions,
} from '../ports/activity-segment.port';
import {
  CustomerDirectoryPort,
  SegmentFilter,
} from '../ports/customer-directory.port';
import { WhatsappBroadcastPort } from '../ports/whatsapp-broadcast.port';
import { CRM_TOKENS } from '../tokens';

/**
 * Broadcast-campaign use cases (PRD Module 12 FR-088/FR-094).
 *
 * Recipients come from EITHER an explicit staff-supplied list OR an attribute segment
 * (FR-087) resolved from customer-service via the CustomerDirectoryPort. Segment resolution
 * fails closed (SegmentUnavailableError) so a campaign is never built from an empty audience.
 */
/** What one broadcast sweep tick got through. Reported to the caller and the logs. */
export interface CampaignSweepResult {
  campaigns: number;
  sent: number;
  failed: number;
  completed: number;
}

@Injectable()
export class CampaignService {
  private static readonly MAX_LIMIT = 100;
  /**
   * B-17 tick budget. Sized so one tick finishes well inside the sweep's own timeout
   * (SWEEP_TIMEOUT, 600s) even when WhatsApp is slow: 200 recipients at ~1s each still
   * leaves headroom, and anything left over is simply the next tick's work.
   */
  private static readonly BATCH = 200;
  private static readonly MAX_CAMPAIGNS_PER_SWEEP = 5;
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @Inject(CRM_TOKENS.CampaignRepository) private readonly repo: CampaignRepository,
    @Inject(CRM_TOKENS.WhatsappBroadcast) private readonly whatsapp: WhatsappBroadcastPort,
    @Inject(CRM_TOKENS.CustomerDirectory) private readonly directory: CustomerDirectoryPort,
    @Inject(CRM_TOKENS.ActivitySegment) private readonly activity: ActivitySegmentPort,
  ) {}

  async create(
    createdBy: string,
    name: string,
    messageTemplate: string,
    recipients: CreateRecipientData[] = [],
    segment?: SegmentFilter,
    authorization = '',
    scheduledFor?: Date | null,
  ): Promise<CampaignRecord> {
    // A segment (FR-087) resolves its own audience from the customer directory; otherwise
    // use the explicit list. A PRESENT segment is always resolved — an EMPTY filter means
    // "all reachable customers" (SegmentFilter contract; design 10d "Semua pelanggan"),
    // not "fall back to the explicit list". Resolution throws if the directory is unreachable.
    let list: CreateRecipientData[] = recipients;
    if (segment) {
      // Two owners, one audience. The directory answers tier/city (customer attributes) and
      // order-service answers the activity half (lapsed, new, frequent, ordered-at-depot);
      // the campaign is the intersection. Before this, an activity segment was SIZED from
      // order-service and SENT as `{tier:'GOLD'}` or `{}` — the screen promised 40 lapsed
      // customers and the blast reached everyone.
      const { tier, city, customerIds, ...activityConditions } = segment;
      const inSegment = hasActivityConditions(activityConditions)
        ? new Set(await this.activity.customersIn(activityConditions))
        : null;
      // A named list narrows the same way a rule does, and for the same reason: the
      // directory is what turns an id into a reachable phone. An id nobody can be
      // messaged at simply is not in the audience.
      const named = customerIds?.length ? new Set(customerIds) : null;
      // ponytail: the intersection is done here rather than pushed into the directory query
      // because the directory read is already whole-audience for an empty filter. If a
      // deployment ever outgrows that, the id list belongs in the directory's WHERE.
      const resolved = await this.directory.resolveSegment({ tier, city }, authorization);
      list = resolved
        .filter((r) => !inSegment || inSegment.has(r.customerId))
        .filter((r) => !named || named.has(r.customerId))
        .map((r) => ({ customerId: r.customerId, phone: r.phone, name: r.name }));
    }

    // Dedupe by phone (last wins) — a pasted list often repeats numbers, and the DB has a
    // unique(campaignId, phone) constraint that would otherwise reject the insert.
    const deduped = [...new Map(list.map((r) => [r.phone, r])).values()];
    if (deduped.length === 0) throw new NoRecipientsError();
    return this.repo.create({ createdBy, name, messageTemplate, recipients: deduped, scheduledFor });
  }

  /**
   * A depot blasting its OWN customers (design 11a).
   *
   * Two things are different from `create`, and both are the reason this is a separate
   * entry point rather than a flag. The segment's `depotId` is OVERWRITTEN with the one the
   * DepotScopeGuard already checked against the caller's depots — a body that named another
   * depot cannot survive here. And the attribute half is read as a SERVICE, because a depot
   * manager holds `depotCampaign`, not the head-office right to page the customer directory.
   */
  async createForDepot(
    createdBy: string,
    depotId: string,
    name: string,
    messageTemplate: string,
    segment: SegmentFilter = {},
    scheduledFor?: Date | null,
  ): Promise<CampaignRecord> {
    const { tier, city, ...activityConditions } = { ...segment, depotId };
    const inSegment = new Set(await this.activity.customersIn(activityConditions));
    const resolved = await this.directory.resolveSegmentAsService({ tier, city });
    const list = resolved
      .filter((r) => inSegment.has(r.customerId))
      .map((r) => ({ customerId: r.customerId, phone: r.phone, name: r.name }));

    const deduped = [...new Map(list.map((r) => [r.phone, r])).values()];
    if (deduped.length === 0) throw new NoRecipientsError();
    return this.repo.create({ createdBy, name, messageTemplate, recipients: deduped, scheduledFor });
  }

  // No defaults here on purpose: the only caller already defaults, so a second set
  // would be two places to change and a branch nothing can reach.
  private clampPage(page: number, limit: number): { p: number; l: number } {
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
   * Accept a DRAFT campaign for dispatch and return immediately (B-17).
   *
   * This used to send the whole campaign inside the HTTP request: one WhatsApp call plus
   * one database write per recipient, sequentially. On any real list the proxy timed out
   * long before the loop did, the caller got a 504, the loop kept running unobserved, and
   * if the container was recycled the campaign stranded in SENDING with finalize() never
   * reached — half the customers messaged, no record of which half.
   *
   * The claim is now a conditional update (DRAFT is in the WHERE), so two simultaneous
   * sends cannot both pass the check and broadcast twice. The actual sending is done by
   * processSending() from the scheduler, against the recipient rows as the queue.
   */
  async send(id: string): Promise<CampaignRecord> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError();
    if (!canSend(campaign.status)) throw new CampaignNotDraftError();

    // canSend() above is courtesy — this is the guard. A read-then-write pair is not one.
    if (!(await this.repo.markSending(id))) throw new CampaignNotDraftError();

    return this.get(id);
  }

  /**
   * Continue every campaign that is mid-broadcast. Called by the scheduler sidecar every
   * couple of minutes; safe to call at any time and safe to interrupt.
   *
   * Bounded on purpose: at most MAX_CAMPAIGNS_PER_SWEEP campaigns and BATCH recipients
   * each per tick. A tick is a unit of progress, not a promise to finish — an interrupted
   * sweep leaves the rest of the recipients PENDING, and the next tick picks them up
   * exactly where this one stopped. That resumability is the whole point of putting the
   * cursor in the database.
   */
  async processSending(now = new Date()): Promise<CampaignSweepResult> {
    const campaigns = await this.repo.findSending(CampaignService.MAX_CAMPAIGNS_PER_SWEEP, now);
    const result: CampaignSweepResult = { campaigns: 0, sent: 0, failed: 0, completed: 0 };

    for (const campaign of campaigns) {
      result.campaigns += 1;
      const batch = await this.repo.claimRecipients(campaign.id, CampaignService.BATCH);
      for (const recipient of batch) {
        const message = renderTemplate(campaign.messageTemplate, {
          name: recipient.name ?? undefined,
          phone: recipient.phone,
        });
        const outcome = await this.whatsapp.send(recipient.phone, message);
        if (outcome.ok) {
          result.sent += 1;
          await this.repo.recordRecipientResult(
            recipient.id,
            RecipientStatus.SENT,
            null,
            new Date(),
          );
        } else {
          result.failed += 1;
          await this.repo.recordRecipientResult(
            recipient.id,
            RecipientStatus.FAILED,
            outcome.error ?? 'unknown error',
            null,
          );
        }
      }

      // Counts come from the database, not from this tick's loop — the campaign may have
      // been carried by several ticks, and only the rows know the whole total.
      const tally = await this.repo.tally(campaign.id);
      if (tally.pending === 0) {
        await this.repo.finalize(campaign.id, tally.sent, tally.failed, new Date());
        result.completed += 1;
        this.logger.log(
          `Campaign ${campaign.id} complete: ${tally.sent} delivered, ${tally.failed} failed`,
        );
      }
    }
    return result;
  }
}
