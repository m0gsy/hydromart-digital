import { Injectable, Logger } from '@nestjs/common';

import { DashboardConfigService } from '../../config/dashboard-config.service';
import {
  CrmDepotSummary,
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
  DepotRatingByDepot,
  DepotMonthlyRevenue,
  DepotOperationalCosts,
  DepotSlaByDepot,
  FranchiseDepot,
  HrDepotSummary,
  LowStockLine,
  NetworkDepot,
  SalesReport,
  TopCustomers,
  TopDepots,
} from '../../application/ports/dashboard-sources.port';

/**
 * Fetches report data from order-service and delivery-service over HTTP. This
 * is a best-effort BFF: any non-ok response, network error, or timeout is
 * logged and mapped to `null` so the executive dashboard never 500s because a
 * downstream service blipped.
 */
@Injectable()
export class DashboardSourcesHttpAdapter implements DashboardSourcesPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DashboardSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private applyRange(params: URLSearchParams, range: DateRange): void {
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
  }

  private async fetchJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DashboardSourcesHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { ...headers, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Upstream ${url} responded ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn(`Upstream ${url} failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch forwarding the caller's user JWT (used only for owner-scoped /depots/mine). */
  private get<T>(url: string, token: string): Promise<T | null> {
    return this.fetchJson<T>(url, { authorization: token });
  }

  /**
   * Fetch as the trusted system principal via the shared internal key (NO user JWT).
   * Global report endpoints are admin-only for USER tokens, so a franchise owner's
   * token would 403; this BFF is trusted to fetch them and then intersect to the
   * owner's depots. Never use for /depots/mine — that must resolve the real user.
   */
  private getInternal<T>(url: string): Promise<T | null> {
    return this.fetchJson<T>(url, { 'x-internal-key': this.config.internalServiceKey });
  }

  // Report/data fan-out authenticates as the trusted system principal (internal key),
  // NOT the owner's JWT — the `token` params are unused here and kept only to satisfy
  // the DashboardSourcesPort contract. Results are intersected to the owner's depots
  // upstream in DashboardService.

  /**
   * The depot filter these reads forward. Written even when the set is EMPTY: this BFF
   * fetches as the trusted system principal, so an omitted filter is the whole network —
   * exactly the answer a caller responsible for no depot must not get.
   */
  private applyDepots(params: URLSearchParams, depotIds?: string[]): void {
    if (depotIds) params.set('depotIds', depotIds.join(','));
  }

  async sales(range: DateRange, _token: string, depotIds?: string[]): Promise<SalesReport | null> {
    const params = new URLSearchParams({ granularity: 'monthly' });
    this.applyRange(params, range);
    this.applyDepots(params, depotIds);
    return this.getInternal<SalesReport>(
      `${this.config.orderServiceUrl}/api/v1/reports/sales?${params.toString()}`,
    );
  }

  async topCustomers(
    range: DateRange,
    limit: number,
    _token: string,
    depotIds?: string[],
  ): Promise<TopCustomers | null> {
    const params = new URLSearchParams({ limit: String(limit) });
    this.applyRange(params, range);
    this.applyDepots(params, depotIds);
    return this.getInternal<TopCustomers>(
      `${this.config.orderServiceUrl}/api/v1/reports/top-customers?${params.toString()}`,
    );
  }

  async topDepots(
    range: DateRange,
    limit: number,
    _token: string,
    depotIds?: string[],
  ): Promise<TopDepots | null> {
    const params = new URLSearchParams({ limit: String(limit) });
    this.applyRange(params, range);
    this.applyDepots(params, depotIds);
    return this.getInternal<TopDepots>(
      `${this.config.orderServiceUrl}/api/v1/reports/top-depots?${params.toString()}`,
    );
  }

  async deliverySla(
    range: DateRange,
    _token: string,
    depotIds?: string[],
  ): Promise<DeliverySla | null> {
    const params = new URLSearchParams();
    this.applyRange(params, range);
    if (depotIds && depotIds.length > 0) params.set('depotIds', depotIds.join(','));
    // HD-6: no threshold is forwarded. delivery-service stores the on-time status when a
    // delivery completes and applies its own threshold chain to older rows; admin's policy
    // copy is not the effective value.
    const query = params.toString();
    return this.getInternal<DeliverySla>(
      `${this.config.deliveryServiceUrl}/api/v1/reports/sla${query ? `?${query}` : ''}`,
    );
  }

  async myDepots(token: string): Promise<FranchiseDepot[] | null> {
    return this.get<FranchiseDepot[]>(`${this.config.depotServiceUrl}/api/v1/depots/mine`, token);
  }

  async lowStock(depotId: string, _token: string): Promise<LowStockLine[] | null> {
    const params = new URLSearchParams({ depotId });
    return this.getInternal<LowStockLine[]>(
      `${this.config.depotServiceUrl}/api/v1/inventory/low-stock?${params.toString()}`,
    );
  }

  /**
   * One request for every owned depot (audit S-1). depot-service returns the lines flat,
   * so they are grouped here by depotId; a depot with nothing low is an empty list, not a
   * missing key — the dashboard renders a card per depot either way.
   */
  async lowStockMany(
    depotIds: string[],
    _token: string,
  ): Promise<Map<string, LowStockLine[]> | null> {
    if (depotIds.length === 0) return new Map();
    const params = new URLSearchParams({ depotIds: depotIds.join(',') });
    const lines = await this.getInternal<LowStockLine[]>(
      `${this.config.depotServiceUrl}/api/v1/inventory/low-stock?${params.toString()}`,
    );
    if (lines === null) return null;
    const out = new Map<string, LowStockLine[]>(depotIds.map((id) => [id, []]));
    for (const line of lines) out.get(line.depotId)?.push(line);
    return out;
  }

  // Pages through depots/manage (limit 100 is its maximum, page its offset): a roll-up, and the
  // pending-approvals depot walk, must not stop at the first hundred. Any page failing is null,
  // never a partial list.
  // ponytail: pages are read one after another; fetch them in parallel if the network ever
  // runs to a few hundred depots.
  async allDepots(_token: string): Promise<NetworkDepot[] | null> {
    const url = (page: number) =>
      `${this.config.depotServiceUrl}/api/v1/depots/manage?limit=100&page=${page}`;
    const first = await this.getInternal<{ items: NetworkDepot[]; totalPages?: number }>(url(1));
    if (!first) return null;
    const items = [...first.items];
    // The service refuses pages past 1000, so a longer list could only be read in part: null,
    // never a partial list (a depot network of 100 000 depots is not this one).
    const pages = first.totalPages ?? 1;
    if (pages > 1000) return null;
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.getInternal<{ items: NetworkDepot[] }>(url(page));
      if (!next) return null;
      items.push(...next.items);
    }
    return items;
  }

  async slaByDepot(range: DateRange, _token: string): Promise<DepotSlaByDepot | null> {
    const params = new URLSearchParams();
    this.applyRange(params, range);
    // HD-6: no threshold is forwarded. delivery-service stores the on-time status when a
    // delivery completes and applies its own threshold chain to older rows; admin's policy
    // copy is not the effective value.
    const query = params.toString();
    return this.getInternal<DepotSlaByDepot>(
      `${this.config.deliveryServiceUrl}/api/v1/reports/sla-by-depot${query ? `?${query}` : ''}`,
    );
  }

  async ratingByDepot(range: DateRange, _token: string): Promise<DepotRatingByDepot | null> {
    const params = new URLSearchParams();
    this.applyRange(params, range);
    const query = params.toString();
    return this.getInternal<DepotRatingByDepot>(
      `${this.config.orderServiceUrl}/api/v1/reports/rating-by-depot${query ? `?${query}` : ''}`,
    );
  }

  async depotMonthly(
    depotId: string,
    month: string,
    _token: string,
  ): Promise<DepotMonthlyRevenue | null> {
    const params = new URLSearchParams({ depotId, month });
    return this.getInternal<DepotMonthlyRevenue>(
      `${this.config.orderServiceUrl}/api/v1/reports/depot-monthly?${params.toString()}`,
    );
  }

  async operationalCosts(
    depotId: string,
    range: Required<DateRange>,
    _token: string,
  ): Promise<DepotOperationalCosts | null> {
    const params = new URLSearchParams({ depotId, from: range.from, to: range.to });
    return this.getInternal<DepotOperationalCosts>(
      `${this.config.depotServiceUrl}/api/v1/reports/operational-costs?${params.toString()}`,
    );
  }

  async hrSummary(depotId: string): Promise<HrDepotSummary | null> {
    if (!this.config.hrServiceUrl) return null;
    const params = new URLSearchParams({ depotId });
    return this.getInternal<HrDepotSummary>(
      `${this.config.hrServiceUrl}/api/v1/hr-reports/internal/depot-summary?${params.toString()}`,
    );
  }

  async hrSummaryMany(depotIds: string[], month?: string): Promise<(HrDepotSummary | null)[]> {
    if (!this.config.hrServiceUrl || depotIds.length === 0) return depotIds.map(() => null);
    const params = new URLSearchParams({ depotIds: depotIds.join(',') });
    if (month) params.set('periodMonth', month);
    const rows = await this.getInternal<HrDepotSummary[]>(
      `${this.config.hrServiceUrl}/api/v1/hr-reports/internal/depot-summaries?${params.toString()}`,
    );
    if (rows === null) return depotIds.map(() => null);
    const byDepot = new Map(rows.map((r) => [r.depotId, r]));
    return depotIds.map((id) => byDepot.get(id) ?? null);
  }

  async payoutCosts(
    depotIds: string[],
    range: Required<DateRange>,
  ): Promise<Map<string, { commissionIdr: number; expenseClaimIdr: number }> | null> {
    if (!this.config.payoutServiceUrl || depotIds.length === 0) return null;
    const params = new URLSearchParams({
      depotIds: depotIds.join(','),
      from: range.from,
      to: range.to,
    });
    const rows = await this.getInternal<
      { depotId: string; commissionIdr: number; expenseClaimIdr: number }[]
    >(`${this.config.payoutServiceUrl}/api/v1/expenses/internal/depot-costs?${params.toString()}`);
    if (rows === null) return null;
    return new Map(
      rows.map((r) => [
        r.depotId,
        { commissionIdr: r.commissionIdr, expenseClaimIdr: r.expenseClaimIdr },
      ]),
    );
  }

  async depotRefunds(
    depotIds: string[],
    range: Required<DateRange>,
  ): Promise<Map<string, number> | null> {
    if (!this.config.paymentServiceUrl || depotIds.length === 0) return null;
    const params = new URLSearchParams({
      depotIds: depotIds.join(','),
      from: range.from,
      to: range.to,
    });
    // PLP-13: subtract only refunds of orders that still count as sales. Revenue already leaves
    // out CANCELLED and VOIDED orders, so their refund was being counted twice.
    const perOrder = await this.getInternal<{ depotId: string; orderId: string; refundedIdr: number }[]>(
      `${this.config.paymentServiceUrl}/api/v1/payments/internal/depot-refunds-by-order?${params.toString()}`,
    );
    if (perOrder !== null) {
      const counting = await this.countingOrders([...new Set(perOrder.map((r) => r.orderId))]);
      if (counting) {
        const out = new Map<string, number>();
        for (const r of perOrder) {
          if (counting.has(r.orderId)) out.set(r.depotId, (out.get(r.depotId) ?? 0) + r.refundedIdr);
        }
        return out;
      }
    }
    // Either side lacks the new route or is down: keep the old per-depot total rather than blank
    // the P&L. It may over-state refunds (the PLP-13 double count) but it is never invented.
    const rows = await this.getInternal<{ depotId: string; refundedIdr: number }[]>(
      `${this.config.paymentServiceUrl}/api/v1/payments/internal/depot-refunds?${params.toString()}`,
    );
    if (rows === null) return null;
    return new Map(rows.map((r) => [r.depotId, r.refundedIdr]));
  }

  /** PLP-13: of these order ids, those order-service still counts as sales; null = cannot say. */
  private async countingOrders(orderIds: string[]): Promise<Set<string> | null> {
    if (orderIds.length === 0) return new Set();
    const base = this.config.orderServiceUrl;
    if (!base) return null;
    const counting = new Set<string>();
    for (let i = 0; i < orderIds.length; i += 5000) {
      const url = `${base}/api/v1/reports/internal/counting-orders`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DashboardSourcesHttpAdapter.TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'x-internal-key': this.config.internalServiceKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ orderIds: orderIds.slice(i, i + 5000) }),
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(`Upstream ${url} responded ${res.status}`);
          return null;
        }
        for (const id of ((await res.json()) as { orderIds: string[] }).orderIds) counting.add(id);
      } catch (error) {
        this.logger.warn(`Upstream ${url} failed: ${(error as Error).message}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return counting;
  }

  async crmSummaryMany(depotIds: string[]): Promise<(CrmDepotSummary | null)[]> {
    if (!this.config.customerServiceUrl || depotIds.length === 0) return depotIds.map(() => null);
    const params = new URLSearchParams({ depotIds: depotIds.join(',') });
    // The batch route echoes the depot id on each row; the single-depot one does not need
    // to, because the caller already knows which depot it asked about.
    const rows = await this.getInternal<(CrmDepotSummary & { depotId: string })[]>(
      `${this.config.customerServiceUrl}/api/v1/customers/internal/crm-summaries?${params.toString()}`,
    );
    if (rows === null) return depotIds.map(() => null);
    const byDepot = new Map(rows.map((r) => [r.depotId, r]));
    return depotIds.map((id) => byDepot.get(id) ?? null);
  }

  async crmSummary(depotId: string): Promise<CrmDepotSummary | null> {
    if (!this.config.customerServiceUrl) return null;
    const params = new URLSearchParams({ depotId });
    return this.getInternal<CrmDepotSummary>(
      `${this.config.customerServiceUrl}/api/v1/customers/internal/crm-summary?${params.toString()}`,
    );
  }
}
