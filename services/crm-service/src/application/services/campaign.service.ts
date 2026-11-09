import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { CampaignStatus, canCancel, canSend } from '../../domain/campaign-status';
import { RecipientStatus } from '../../domain/recipient-status';
import { renderTemplate } from '../../domain/template';
import {
  CampaignNotCancellableError,
  CampaignNotDraftError,
  CampaignNotFoundError,
  MarketingPreferenceUnavailableError,
  NoRecipientsError,
  RecipientOptedOutError,
  ScheduledInPastError,
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
import { BroadcastDeliveryPort } from '../ports/broadcast-delivery.port';
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
  /** CRM-02: recipients passed over by their own choice (opted out) - not failures. */
  skipped: number;
  /** CRM-02: recipients put back in the queue because a dependency was down. */
  held: number;
  /**
   * J7: false when the round tried to deliver and delivered nothing.
   *
   * `failed` was already counted here and nothing read it. `sweep.sh` refreshed the
   * scheduler heartbeat on the HTTP 200 alone, so a campaign burning its whole audience
   * on recipients it could not reach — every two minutes — wrote the same green marker as
   * a tick with no campaign sending at all.
   */
  ok: boolean;
}

/** Digits only, local 0-prefix read as Indonesian +62, so +62812…, 62812… and 0812… compare equal. */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
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
  private static readonly CONCURRENCY = 8;
  private static readonly MAX_CAMPAIGNS_PER_SWEEP = 5;
  /**
   * CRM-02: how long a recipient may wait out a preference-service outage before it counts as
   * FAILED. Counted from when the campaign was due, so a long outage cannot spin forever.
   */
  private static readonly OUTAGE_GRACE_MS = 24 * 60 * 60 * 1000;
  /** CRM-04: a send time a minute in the past is clock skew; further back is a mistake. */
  private static readonly SCHEDULE_SKEW_MS = 60 * 1000;
  private readonly logger = new Logger(CampaignService.name);

  private assertNotPast(scheduledFor?: Date | null): void {
    if (scheduledFor && scheduledFor.getTime() < Date.now() - CampaignService.SCHEDULE_SKEW_MS) {
      throw new ScheduledInPastError();
    }
  }

  constructor(
    @Inject(CRM_TOKENS.CampaignRepository) private readonly repo: CampaignRepository,
    @Inject(CRM_TOKENS.BroadcastDelivery) private readonly delivery: BroadcastDeliveryPort,
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
    this.assertNotPast(scheduledFor);
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


    if (!segment) list = await this.attachCustomerIds(list, authorization);

    // Dedupe by phone (last wins) — a pasted list often repeats numbers, and the DB has a
    // unique(campaignId, phone) constraint that would otherwise reject the insert.
    const deduped = [...new Map(list.map((r) => [r.phone, r])).values()];
    if (deduped.length === 0) throw new NoRecipientsError();
    return this.repo.create({ createdBy, name, messageTemplate, recipients: deduped, scheduledFor });
  }

  /**
   * A pasted list carries bare phone numbers, but a broadcast is delivered to an inbox and an
   * inbox belongs to a customer id — so every such row used to end FAILED "no Hydromart
   * account", even for a registered customer. Match each number to the directory here.
   *
   * Soft on purpose: if the directory is unreachable the row keeps its null id and is recorded
   * FAILED at delivery with its reason, exactly as before. A number nobody owns stays null.
   * ponytail: whole-directory read, matched in memory (same cost as the segment path); push a
   * phone filter into the directory query if a deployment outgrows it.
   */
  private async attachCustomerIds(
    list: CreateRecipientData[],
    authorization: string,
  ): Promise<CreateRecipientData[]> {
    if (!list.some((r) => !r.customerId)) return list;
    let directory: Awaited<ReturnType<CustomerDirectoryPort['resolveSegment']>>;
    try {
      directory = await this.directory.resolveSegment({}, authorization);
    } catch (e) {
      this.logger.warn(`could not match pasted numbers to customers: ${(e as Error).message}`);
      return list;
    }
    const byPhone = new Map(directory.map((d) => [normalizePhone(d.phone), d]));
    return list.map((r) => {
      if (r.customerId) return r;
      const hit = byPhone.get(normalizePhone(r.phone));
      return hit ? { ...r, customerId: hit.customerId, name: r.name ?? hit.name } : r;
    });
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
    this.assertNotPast(scheduledFor);
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

  /** CRM-05: the campaigns this caller created - what a depot manager may read of their own blasts. */
  async listMine(actorId: string, page = 1, limit = 20): Promise<Page<CampaignRecord>> {
    const { p, l } = this.clampPage(page, limit);
    const { items, total } = await this.repo.list(p, l, actorId);
    return buildPage(items, total, p, l);
  }

  async getOwn(id: string, actorId: string): Promise<CampaignRecord> {
    const campaign = await this.get(id);
    if (campaign.createdBy !== actorId) {
      throw new ForbiddenException('Kampanye ini bukan milik akun Anda.');
    }
    return campaign;
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
  /**
   * A depot sending the campaign IT created (OPS-04).
   *
   * The depot broadcast screen used to POST the draft route and stop there. Nothing sent,
   * nothing failed, the form cleared — 320 customers counted on the button and none of them
   * messaged. It could not simply call `send`: that route carries `campaignWrite`, the
   * head-office right to blast the whole network, which a depot manager does not hold.
   *
   * Ownership is the account that created it. A campaign carries no depot of its own (the
   * depot is baked into the recipient list at creation), so `createdBy` is the honest check
   * — and it is stricter than a depot check anyway.
   */
  async sendOwn(id: string, actorId: string): Promise<CampaignRecord> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError();
    if (campaign.createdBy !== actorId) {
      throw new ForbiddenException('Kampanye ini bukan milik akun Anda.');
    }
    return this.send(id);
  }

  /**
   * CRM-04: stop a campaign that has not finished. A scheduled send used to be unrecallable.
   * Recipients not yet reached become SKIPPED; those already messaged stay as they are.
   */
  async cancel(id: string): Promise<CampaignRecord> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError();
    if (!canCancel(campaign.status)) throw new CampaignNotCancellableError();
    if (!(await this.repo.cancel(id))) throw new CampaignNotCancellableError();
    return this.get(id);
  }

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
    /*
     * The E-2 refusal that used to stand here — "skip the sweep, WHATSAPP_API_URL is
     * unset" — is gone with the transport it guarded.
     *
     * Broadcasts now deliver the way transactional notifications always have: a row in the
     * customer's in-app inbox, plus best-effort push. The inbox write is a database write
     * in this same service, so there is no external endpoint that can be missing and no
     * configuration state in which a sweep would burn an audience on nothing. Push is
     * additive — an unconfigured VAPID or FCM half means fewer devices buzz, not a lost
     * message, because the inbox row is the delivery.
     *
     * What CAN still fail is a recipient with no account to deliver to; that is handled
     * per recipient below rather than by refusing the whole sweep.
     */
    const campaigns = await this.repo.findSending(CampaignService.MAX_CAMPAIGNS_PER_SWEEP, now);
    const result: CampaignSweepResult = {
      campaigns: 0,
      sent: 0,
      failed: 0,
      completed: 0,
      skipped: 0,
      held: 0,
      ok: true,
    };

    for (const campaign of campaigns) {
      result.campaigns += 1;
      const batch = await this.repo.claimRecipients(campaign.id, CampaignService.BATCH);
      // CRM-03: one recipient is a preference read, an inbox write and a push - three round trips
      // to the same places. Serially that is ~200 x 3 per tick; a small pool keeps the sweep inside
      // its interval without hammering the database.
      await runPool(batch, CampaignService.CONCURRENCY, async (recipient) => {
        const message = renderTemplate(campaign.messageTemplate, {
          name: recipient.name ?? undefined,
          phone: recipient.phone,
        });
        /*
         * A broadcast is delivered by writing it to the recipient's inbox, so a recipient
         * with no account has nowhere to receive it. Recorded FAILED with the reason
         * rather than SENT: a staff-supplied list can carry a bare phone number, and
         * counting those as delivered would report a reach the campaign never had.
         */
        if (!recipient.customerId) {
          result.failed += 1;
          await this.repo.recordRecipientResult(
            recipient.id,
            RecipientStatus.FAILED,
            'nomor ini belum punya akun Hydromart atau menolak pesan promosi — tidak ada inbox tujuan',
            null,
          );
          return;
        }
        try {
          await this.delivery.deliver(recipient.phone, message, recipient.customerId);
          result.sent += 1;
          await this.repo.recordRecipientResult(
            recipient.id,
            RecipientStatus.SENT,
            null,
            new Date(),
          );
        } catch (e) {
          const reason = (e as Error).message || 'unknown error';
          if (e instanceof RecipientOptedOutError) {
            // The customer's own choice: a skip, not a delivery failure.
            result.skipped += 1;
            await this.repo.recordRecipientResult(recipient.id, RecipientStatus.SKIPPED, reason, null);
            return;
          }
          const dueAt = (campaign.scheduledFor ?? campaign.createdAt).getTime();
          if (
            e instanceof MarketingPreferenceUnavailableError &&
            now.getTime() - dueAt < CampaignService.OUTAGE_GRACE_MS
          ) {
            // An outage is not the recipient's fault: back in the queue for the next tick.
            result.held += 1;
            await this.repo.recordRecipientResult(recipient.id, RecipientStatus.PENDING, reason, null);
            return;
          }
          result.failed += 1;
          await this.repo.recordRecipientResult(recipient.id, RecipientStatus.FAILED, reason, null);
        }
      });

      // Counts come from the database, not from this tick's loop — the campaign may have
      // been carried by several ticks, and only the rows know the whole total.
      const tally = await this.repo.tally(campaign.id);
      if (tally.pending === 0) {
        // CRM-02: nobody reached, or somebody failed, is not a plain "sent".
        const status =
          tally.failed > 0 || tally.sent === 0
            ? CampaignStatus.COMPLETED_WITH_FAILURES
            : CampaignStatus.SENT;
        await this.repo.finalize(campaign.id, tally.sent, tally.failed, new Date(), status);
        result.completed += 1;
        this.logger.log(
          `Campaign ${campaign.id} complete: ${tally.sent} delivered, ${tally.failed} failed`,
        );
      }
    }
    // An outage that held everyone back is as silent as one that failed everyone.
    result.ok = (result.failed === 0 && result.held === 0) || result.sent > 0;
    return result;
  }
}

/** Runs `fn` over `items` with at most `size` in flight. Results are not collected. */
async function runPool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
