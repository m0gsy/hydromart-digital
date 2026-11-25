import { Injectable, Logger } from '@nestjs/common';

import {
  AiLoyaltySourcesPort,
  CampaignTotals,
  DiscountTotals,
  InstantWindow,
  LoyaltySpan,
  NewSubscriptionTotals,
  OpenQueueRow,
  PointsOutstandingTotals,
  ReferralTotals,
  RedemptionTotals,
} from '../../application/ports/ai-loyalty-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

/** A whole, non-negative count or sum. Anything else is a source that is not what this API understands. */
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The most spans and depots one many-depot read carries; every internal route refuses more (422). */
const MAX_SPANS = 200;
const MAX_DEPOTS = 100;

/**
 * HD-6 H4 part 2: reads loyalty-, referral-, order-, crm- and depot-service with the internal key. A
 * failure, an unwired service, an answer with a figure that is not a whole non-negative number, or one
 * that contradicts itself is null: the metric then says belum_ada, never a partial sum.
 */
@Injectable()
export class AiLoyaltySourcesHttpAdapter implements AiLoyaltySourcesPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(AiLoyaltySourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async call(base: string | undefined, path: string, init: { query?: Record<string, string>; body?: unknown } = {}): Promise<Record<string, unknown> | null> {
    if (!base) return null;
    const url = `${base}/api/v1/${path}${init.query ? `?${new URLSearchParams(init.query).toString()}` : ''}`;
    try {
      const res = await fetch(url, {
        method: init.body === undefined ? 'GET' : 'POST',
        headers: {
          'x-internal-key': this.config.internalServiceKey,
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(AiLoyaltySourcesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${path} answered ${res.status}`);
        return null;
      }
      return asRecord(await res.json());
    } catch (error) {
      this.logger.warn(`${path} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  private fits(spans: readonly LoyaltySpan[]): boolean {
    return spans.length > 0 && spans.length <= MAX_SPANS && new Set(spans.map((s) => s.depotId)).size <= MAX_DEPOTS;
  }

  async redemptions(spans: readonly LoyaltySpan[]): Promise<RedemptionTotals | null> {
    if (!this.fits(spans)) return null;
    const b = await this.call(this.config.loyaltyServiceUrl, 'loyalty/internal/ai/redemptions', { body: { spans } });
    if (!b || !isCount(b.redemptions) || !isCount(b.points) || !isCount(b.redeemers) || !isCount(b.unplaced)) return null;
    // Each redeemer redeemed at least once, and nobody redeemed without being counted.
    if (b.redeemers > b.redemptions || (b.redemptions > 0) !== (b.redeemers > 0)) return null;
    return { redemptions: b.redemptions, points: b.points, redeemers: b.redeemers, unplaced: b.unplaced };
  }

  async pointsOutstanding(before: string): Promise<PointsOutstandingTotals | null> {
    const b = await this.call(this.config.loyaltyServiceUrl, 'loyalty/internal/ai/points-outstanding', { query: { before } });
    return b && isCount(b.accounts) && isCount(b.points) ? { accounts: b.accounts, points: b.points } : null;
  }

  async referrals(window: InstantWindow): Promise<ReferralTotals | null> {
    const b = await this.call(this.config.referralServiceUrl, 'referrals/internal/ai/totals', { query: { ...window } });
    if (!b || !isCount(b.invited) || !isCount(b.qualified) || !isCount(b.referrerPoints) || !isCount(b.refereePoints)) return null;
    return { invited: b.invited, qualified: b.qualified, referrerPoints: b.referrerPoints, refereePoints: b.refereePoints };
  }

  async discounts(spans: readonly LoyaltySpan[]): Promise<DiscountTotals | null> {
    if (!this.fits(spans)) return null;
    const b = await this.call(this.config.orderServiceUrl, 'reports/internal/discount-metrics', { body: { spans } });
    if (!b || !isCount(b.orders) || !isCount(b.discountedOrders) || !isMoney(b.discountIdr)) return null;
    // A discounted order is an order, and a discount needs one.
    if (b.discountedOrders > b.orders || (b.discountedOrders === 0 && b.discountIdr !== 0)) return null;
    return { orders: b.orders, discountedOrders: b.discountedOrders, discountIdr: b.discountIdr };
  }

  async newSubscriptions(window: InstantWindow): Promise<NewSubscriptionTotals | null> {
    const b = await this.call(this.config.orderServiceUrl, 'reports/internal/subscription-metrics', { query: { ...window } });
    if (!b || !isCount(b.subscriptions) || !isCount(b.subscribers)) return null;
    // Every subscriber has at least one plan.
    if (b.subscribers > b.subscriptions || (b.subscriptions > 0) !== (b.subscribers > 0)) return null;
    return { subscriptions: b.subscriptions, subscribers: b.subscribers };
  }

  async campaigns(window: InstantWindow): Promise<CampaignTotals | null> {
    const b = await this.call(this.config.crmServiceUrl, 'campaigns/internal/ai/totals', { query: { ...window } });
    if (!b || !isCount(b.campaigns) || !isCount(b.sent) || !isCount(b.failed) || !isCount(b.skipped) || !isCount(b.other)) return null;
    return { campaigns: b.campaigns, sent: b.sent, failed: b.failed, skipped: b.skipped, other: b.other };
  }

  async openQueues(depotIds: readonly string[]): Promise<OpenQueueRow[] | null> {
    if (depotIds.length === 0 || depotIds.length > MAX_DEPOTS) return null;
    const b = await this.call(this.config.depotServiceUrl, 'internal/ai-queues/open', { query: { depotIds: depotIds.join(',') } });
    const items = b?.items;
    if (!Array.isArray(items)) return null;
    const asked = new Set(depotIds);
    const seen = new Set<string>();
    const rows: OpenQueueRow[] = [];
    for (const raw of items) {
      const r = asRecord(raw);
      if (!r || typeof r.depotId !== 'string' || !asked.has(r.depotId) || seen.has(r.depotId)) return null;
      if (!isCount(r.incidents) || !isCount(r.disputes) || !isCount(r.approvals) || !isCount(r.maintenanceOverdue)) return null;
      seen.add(r.depotId);
      rows.push({ depotId: r.depotId, incidents: r.incidents, disputes: r.disputes, approvals: r.approvals, maintenanceOverdue: r.maintenanceOverdue });
    }
    // One row for every depot asked: a missing one would be a silent undercount.
    return seen.size === asked.size ? rows : null;
  }
}
