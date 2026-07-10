import { Injectable, Logger } from '@nestjs/common';

import { DashboardConfigService } from '../../config/dashboard-config.service';
import {
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
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

  private async get<T>(url: string, token: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DashboardSourcesHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { authorization: token, accept: 'application/json' },
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

  async sales(range: DateRange, token: string): Promise<SalesReport | null> {
    const params = new URLSearchParams({ granularity: 'monthly' });
    this.applyRange(params, range);
    return this.get<SalesReport>(
      `${this.config.orderServiceUrl}/api/v1/reports/sales?${params.toString()}`,
      token,
    );
  }

  async topCustomers(range: DateRange, limit: number, token: string): Promise<TopCustomers | null> {
    const params = new URLSearchParams({ limit: String(limit) });
    this.applyRange(params, range);
    return this.get<TopCustomers>(
      `${this.config.orderServiceUrl}/api/v1/reports/top-customers?${params.toString()}`,
      token,
    );
  }

  async topDepots(range: DateRange, limit: number, token: string): Promise<TopDepots | null> {
    const params = new URLSearchParams({ limit: String(limit) });
    this.applyRange(params, range);
    return this.get<TopDepots>(
      `${this.config.orderServiceUrl}/api/v1/reports/top-depots?${params.toString()}`,
      token,
    );
  }

  async deliverySla(range: DateRange, token: string): Promise<DeliverySla | null> {
    const params = new URLSearchParams();
    this.applyRange(params, range);
    const query = params.toString();
    return this.get<DeliverySla>(
      `${this.config.deliveryServiceUrl}/api/v1/reports/sla${query ? `?${query}` : ''}`,
      token,
    );
  }
}
