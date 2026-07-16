import { Injectable, Logger } from '@nestjs/common';

import { DashboardConfigService } from '../../config/dashboard-config.service';
import {
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
  DepotSlaByDepot,
  FranchiseDepot,
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

  async sales(range: DateRange, _token: string): Promise<SalesReport | null> {
    const params = new URLSearchParams({ granularity: 'monthly' });
    this.applyRange(params, range);
    return this.getInternal<SalesReport>(
      `${this.config.orderServiceUrl}/api/v1/reports/sales?${params.toString()}`,
    );
  }

  async topCustomers(range: DateRange, limit: number, _token: string): Promise<TopCustomers | null> {
    const params = new URLSearchParams({ limit: String(limit) });
    this.applyRange(params, range);
    return this.getInternal<TopCustomers>(
      `${this.config.orderServiceUrl}/api/v1/reports/top-customers?${params.toString()}`,
    );
  }

  async topDepots(range: DateRange, limit: number, _token: string): Promise<TopDepots | null> {
    const params = new URLSearchParams({ limit: String(limit) });
    this.applyRange(params, range);
    return this.getInternal<TopDepots>(
      `${this.config.orderServiceUrl}/api/v1/reports/top-depots?${params.toString()}`,
    );
  }

  /**
   * Org SLA on-time threshold (minutes) from admin-service, or null when admin
   * isn't wired / the lookup fails. Best-effort: delivery-service applies its own
   * default when we don't forward a threshold, so a null here changes nothing.
   */
  private async slaThresholdMinutes(): Promise<number | null> {
    if (!this.config.adminServiceUrl) return null;
    const policy = await this.getInternal<{ onTimeThresholdMinutes: number }>(
      `${this.config.adminServiceUrl}/api/v1/sla-policy`,
    );
    return policy?.onTimeThresholdMinutes ?? null;
  }

  async deliverySla(
    range: DateRange,
    _token: string,
    depotIds?: string[],
  ): Promise<DeliverySla | null> {
    const params = new URLSearchParams();
    this.applyRange(params, range);
    if (depotIds && depotIds.length > 0) params.set('depotIds', depotIds.join(','));
    const threshold = await this.slaThresholdMinutes();
    if (threshold != null) params.set('thresholdMinutes', String(threshold));
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

  // ponytail: single page of 100 depots — the whole network today. Add pagination
  // to allDepots (and the roll-up fan-out) when the depot count outgrows one page.
  async allDepots(_token: string): Promise<NetworkDepot[] | null> {
    const page = await this.getInternal<{ items: NetworkDepot[] }>(
      `${this.config.depotServiceUrl}/api/v1/depots/manage?limit=100`,
    );
    return page ? page.items : null;
  }

  async slaByDepot(range: DateRange, _token: string): Promise<DepotSlaByDepot | null> {
    const params = new URLSearchParams();
    this.applyRange(params, range);
    const threshold = await this.slaThresholdMinutes();
    if (threshold != null) params.set('thresholdMinutes', String(threshold));
    const query = params.toString();
    return this.getInternal<DepotSlaByDepot>(
      `${this.config.deliveryServiceUrl}/api/v1/reports/sla-by-depot${query ? `?${query}` : ''}`,
    );
  }
}
