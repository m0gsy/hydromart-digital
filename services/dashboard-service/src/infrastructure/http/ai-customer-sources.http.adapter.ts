import { Injectable, Logger } from '@nestjs/common';

import {
  AiCustomerSourcesPort,
  CohortCell,
  CustomerWindow,
  DeliverySummary,
  FAILURE_REASON_CODES,
  FailureReasonCode,
  GallonLedgerRow,
  RatingTotals,
  RefillTotals,
  SegmentTotals,
  SourceSpan,
} from '../../application/ports/ai-customer-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

/** A count: a finite, whole, non-negative number. Anything else is a source we do not understand. */
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const allCounts = (o: Record<string, unknown>, keys: readonly string[]): boolean => keys.every((k) => isCount(o[k]));

/**
 * HD-6 H3: reads the customer, delivery and gallon facts with the internal key. Any failure, an
 * unwired service, a number that is not a count, or a row for a depot nobody asked is null, so the
 * metric says belum_ada rather than answering from a partial read.
 */
@Injectable()
export class AiCustomerSourcesHttpAdapter implements AiCustomerSourcesPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(AiCustomerSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async call(url: string, body?: unknown): Promise<unknown | null> {
    const where = url.split('?')[0];
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-internal-key': this.config.internalServiceKey,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(AiCustomerSourcesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${where} answered ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (error) {
      this.logger.warn(`${where} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  private order(path: string, body: unknown): Promise<unknown | null> {
    return this.call(`${this.config.orderServiceUrl}/api/v1/reports/internal/${path}`, body);
  }

  async customerWindow(spans: readonly SourceSpan[], periodFrom: string): Promise<CustomerWindow | null> {
    const b = await this.order('customer-metrics', { spans, periodFrom });
    if (!isObj(b) || !allCounts(b, ['active', 'newCustomers', 'repeat']) || !Array.isArray(b.newAtDepot)) return null;
    const asked = new Set(spans.map((s) => s.depotId));
    const rows = b.newAtDepot as unknown[];
    if (!rows.every((r) => isObj(r) && typeof r.depotId === 'string' && asked.has(r.depotId) && isCount(r.customers))) return null;
    // "new" and "repeat" are parts of "active": more than the whole is a source we cannot trust.
    if ((b.newCustomers as number) > (b.active as number) || (b.repeat as number) > (b.active as number)) return null;
    return {
      active: b.active as number,
      newCustomers: b.newCustomers as number,
      repeat: b.repeat as number,
      newAtDepot: rows.map((r) => ({ depotId: (r as { depotId: string }).depotId, customers: (r as { customers: number }).customers })),
    };
  }

  async cohorts(spans: readonly SourceSpan[]): Promise<CohortCell[] | null> {
    const b = await this.order('customer-cohorts', { spans });
    if (!isObj(b) || !Array.isArray(b.cells)) return null;
    const ok = (b.cells as unknown[]).every(
      (c) => isObj(c) && typeof c.cohort === 'string' && /^\d{4}-\d{2}$/.test(c.cohort) && isCount(c.monthIndex) && isCount(c.customers),
    );
    return ok ? (b.cells as CohortCell[]) : null;
  }

  async ratings(spans: readonly SourceSpan[]): Promise<RatingTotals | null> {
    const b = await this.order('rating-metrics', { spans });
    if (!isObj(b) || !allCounts(b, ['reviews', 'ratingSum', 'reviewers'])) return null;
    // Stars are 1 to 5: a sum outside that is not a sum of reviews.
    const t = { reviews: b.reviews as number, ratingSum: b.ratingSum as number, reviewers: b.reviewers as number };
    if (t.ratingSum < t.reviews || t.ratingSum > 5 * t.reviews || t.reviewers > t.reviews) return null;
    return t;
  }

  async segments(depotIds: readonly string[], at: { riskSince: string; activeSince: string; until: string }): Promise<SegmentTotals | null> {
    const b = await this.order('customer-segments', { depotIds: depotIds.join(','), ...at });
    return isObj(b) && allCounts(b, ['active', 'atRisk', 'inactive'])
      ? { active: b.active as number, atRisk: b.atRisk as number, inactive: b.inactive as number }
      : null;
  }

  async gallonsSold(spans: readonly SourceSpan[]) {
    const b = await this.order('gallon-metrics', { spans });
    if (!isObj(b) || !isCount(b.gallons)) return null;
    const rows = Array.isArray(b.byDepot) ? (b.byDepot as unknown[]) : null;
    // An older order-service answers the total only; a malformed list is no list at all.
    const ok = rows?.every((r) => isObj(r) && typeof r.depotId === 'string' && isCount(r.gallons));
    return { gallons: b.gallons, byDepot: rows && ok ? rows.map((r) => ({ depotId: (r as { depotId: string }).depotId, gallons: (r as { gallons: number }).gallons })) : null };
  }

  async refillSplit(spans: readonly SourceSpan[]): Promise<RefillTotals | null> {
    const b = await this.order('refill-split', { spans });
    return isObj(b) && allCounts(b, ['refill', 'partial', 'beli', 'notAsked'])
      ? { refill: b.refill as number, partial: b.partial as number, beli: b.beli as number, notAsked: b.notAsked as number }
      : null;
  }

  async liveOrders(depotIds: readonly string[]): Promise<{ status: string; count: number }[] | null> {
    const b = await this.call(`${this.config.orderServiceUrl}/api/v1/reports/internal/live-orders?depotIds=${depotIds.join(',')}`);
    if (!isObj(b) || !Array.isArray(b.byStatus)) return null;
    const rows = b.byStatus as unknown[];
    return rows.every((r) => isObj(r) && typeof r.status === 'string' && isCount(r.count))
      ? rows.map((r) => ({ status: (r as { status: string }).status, count: (r as { count: number }).count }))
      : null;
  }

  async deliverySummary(spans: readonly SourceSpan[]): Promise<DeliverySummary | null> {
    const b = await this.call(`${this.config.deliveryServiceUrl}/api/v1/reports/internal/ai-summary`, { spans });
    const counts = ['delivered', 'onTime', 'storedVerdicts', 'couriers', 'failed', 'noShow', 'otherFailed', 'rescheduled'] as const;
    if (!isObj(b) || !allCounts(b, counts) || (b.thresholdMinutes !== null && !isCount(b.thresholdMinutes))) return null;
    if (b.medianMinutes !== null && !isNum(b.medianMinutes)) return null;
    // The parts must fit their wholes, or the source and this reader disagree about the shape.
    const d = b as unknown as DeliverySummary;
    if (d.onTime > d.delivered || d.storedVerdicts > d.delivered || d.couriers > d.delivered + d.failed) return null;
    if (d.couriers === 0 && d.delivered + d.failed > 0) return null;
    if (d.noShow + d.otherFailed !== d.failed) return null;
    if ((d.delivered === 0) !== (d.medianMinutes === null)) return null;
    return { ...d, byReason: AiCustomerSourcesHttpAdapter.reasons(b.byReason, d) };
  }

  /** The breakdown or null: missing, malformed, or not adding up to failed / noShow (unknown extra codes are ignored). */
  private static reasons(v: unknown, d: DeliverySummary): DeliverySummary['byReason'] {
    if (!isObj(v) || !allCounts(v, FAILURE_REASON_CODES)) return null;
    const r = Object.fromEntries(FAILURE_REASON_CODES.map((k) => [k, v[k] as number])) as Record<FailureReasonCode, number>;
    const sum = FAILURE_REASON_CODES.reduce((n, k) => n + r[k], 0);
    return sum === d.failed && r.NO_SHOW === d.noShow ? r : null;
  }

  async cancelledBeforeDeparture(spans: readonly SourceSpan[]): Promise<number | null> {
    const b = await this.order('cancelled-before-departure', { spans });
    return isObj(b) && isCount(b.cancelled) ? b.cancelled : null;
  }

  async gallonLedger(depotIds: readonly string[], range: { from: string; to: string }): Promise<GallonLedgerRow[] | null> {
    const q = new URLSearchParams({ depotIds: depotIds.join(','), ...range }).toString();
    const b = await this.call(`${this.config.depotServiceUrl}/api/v1/gallon-outstanding/internal/ledger-summary?${q}`);
    if (!isObj(b) || !Array.isArray(b.items)) return null;
    const asked = new Set(depotIds);
    const keys = [
      'issuedTotal',
      'returnedTotal',
      'depositHeldTotal',
      'depositRefundedTotal',
      'issuedInWindow',
      'depositHeldInWindow',
      'returnedGoodInWindow',
      'returnedDamagedInWindow',
      'depositRefundedInWindow',
    ] as const;
    const rows = b.items as unknown[];
    // Reversals make a window sum negative, so these are numbers, not counts; a depot nobody asked, or twice, is not ours.
    const seen = new Set<string>();
    const fine = rows.every((r) => {
      if (!isObj(r) || typeof r.depotId !== 'string' || !asked.has(r.depotId) || seen.has(r.depotId)) return false;
      seen.add(r.depotId);
      return keys.every((k) => isNum(r[k]));
    });
    return fine ? (rows as GallonLedgerRow[]) : null;
  }
}
