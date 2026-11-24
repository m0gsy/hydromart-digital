import { Injectable, Logger } from '@nestjs/common';

import {
  AiMoneySourcesPort,
  DepotMoneyRow,
  DepotSalesRow,
  InstantRange,
  MoneyKind,
  ProductRow,
  TimeAreaRows,
} from '../../application/ports/ai-money-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isList = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every((r) => r && typeof r === 'object');

/**
 * HD-6 H2: reads the money facts from order, payment, depot and delivery service with the internal
 * key. Any failure, an unwired service, or an answer that is not the shape expected is null, so a
 * metric says belum_ada rather than answering from a partial read.
 */
@Injectable()
export class AiMoneySourcesHttpAdapter implements AiMoneySourcesPort {
  private static readonly TIMEOUT_MS = 8000;
  private static readonly COUNTING_BATCH = 5000;
  private readonly logger = new Logger(AiMoneySourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async call(url: string, init?: { method: 'POST'; body: unknown }): Promise<unknown | null> {
    const where = url.split('?')[0];
    try {
      const res = await fetch(url, {
        method: init?.method ?? 'GET',
        headers: {
          'x-internal-key': this.config.internalServiceKey,
          accept: 'application/json',
          ...(init ? { 'content-type': 'application/json' } : {}),
        },
        ...(init ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(AiMoneySourcesHttpAdapter.TIMEOUT_MS),
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

  private q(params: Record<string, string>): string {
    return new URLSearchParams(params).toString();
  }

  async salesSummary(depotIds: readonly string[], range: InstantRange): Promise<DepotSalesRow[] | null> {
    const body = (await this.call(
      `${this.config.orderServiceUrl}/api/v1/reports/internal/depot-sales-summary?${this.q({ depotIds: depotIds.join(','), ...range })}`,
    )) as { items?: unknown } | null;
    const items = body?.items;
    if (!isList(items)) return null;
    const keys = ['orders', 'revenueIdr', 'shippingIdr', 'appOrders', 'appRevenueIdr', 'counterOrders', 'counterRevenueIdr', 'cancelledOrders', 'deliveredOrders'];
    if (!items.every((r) => typeof r.depotId === 'string' && keys.every((k) => isNum(r[k])))) return null;
    return items as unknown as DepotSalesRow[];
  }

  async productRevenue(depotIds: readonly string[], range: InstantRange): Promise<ProductRow[] | null> {
    const body = (await this.call(
      `${this.config.orderServiceUrl}/api/v1/reports/revenue-by-category?${this.q({ depotIds: depotIds.join(','), limit: '50', ...range })}`,
    )) as { items?: unknown } | null;
    const items = body?.items;
    if (!isList(items)) return null;
    if (!items.every((r) => typeof r.productName === 'string' && isNum(r.orderCount) && isNum(r.revenue))) return null;
    return items.map((r) => ({
      productId: String(r.productId ?? r.productName),
      productName: r.productName as string,
      orders: r.orderCount as number,
      revenueIdr: r.revenue as number,
    }));
  }

  async timeArea(depotIds: readonly string[], range: InstantRange): Promise<TimeAreaRows | null> {
    const body = (await this.call(
      `${this.config.orderServiceUrl}/api/v1/reports/time-area?${this.q({ depotIds: depotIds.join(','), ...range })}`,
    )) as { heat?: unknown; byWeekday?: unknown; byArea?: unknown; otherAreas?: { orders?: unknown; revenue?: unknown } | null } | null;
    if (!body || !Array.isArray(body.heat) || !body.heat.every((row) => Array.isArray(row) && row.every(isNum))) return null;
    if (!isList(body.byWeekday) || !isList(body.byArea)) return null;
    if (!body.byWeekday.every((r) => isNum(r.weekday) && isNum(r.orders) && isNum(r.revenue))) return null;
    if (!body.byArea.every((r) => typeof r.area === 'string' && isNum(r.orders) && isNum(r.revenue))) return null;
    const other = body.otherAreas;
    return {
      heat: body.heat as number[][],
      byWeekday: body.byWeekday.map((r) => ({ weekday: r.weekday as number, orders: r.orders as number, revenueIdr: r.revenue as number })),
      byArea: body.byArea.map((r) => ({ area: r.area as string, orders: r.orders as number, revenueIdr: r.revenue as number })),
      otherAreas: other && isNum(other.orders) && isNum(other.revenue) ? { orders: other.orders, revenueIdr: other.revenue } : null,
    };
  }

  async money(kind: MoneyKind, depotIds: readonly string[], range: InstantRange): Promise<DepotMoneyRow[] | null> {
    const base = this.config.paymentServiceUrl;
    if (!base) return null;
    const body = (await this.call(
      `${base}/api/v1/payments/internal/depot-money?${this.q({ kind, depotIds: depotIds.join(','), ...range })}`,
    )) as { rows?: unknown } | null;
    const rows = body?.rows;
    if (!isList(rows)) return null;
    const valid = rows.every(
      (r) =>
        typeof r.depotId === 'string' &&
        (r.channel === 'counter' || r.channel === 'delivery') &&
        typeof r.method === 'string' &&
        isNum(r.amountIdr) &&
        isNum(r.count),
    );
    return valid ? (rows as unknown as DepotMoneyRow[]) : null;
  }

  async countingOrders(orderIds: readonly string[]): Promise<Set<string> | null> {
    const counting = new Set<string>();
    for (let i = 0; i < orderIds.length; i += AiMoneySourcesHttpAdapter.COUNTING_BATCH) {
      const body = (await this.call(`${this.config.orderServiceUrl}/api/v1/reports/internal/counting-orders`, {
        method: 'POST',
        body: { orderIds: orderIds.slice(i, i + AiMoneySourcesHttpAdapter.COUNTING_BATCH) },
      })) as { orderIds?: unknown } | null;
      if (!Array.isArray(body?.orderIds)) return null;
      for (const id of body.orderIds) counting.add(String(id));
    }
    return counting;
  }

  async cashbookCosts(depotId: string, range: InstantRange): Promise<{ cogsIdr: number; opexIdr: number } | null> {
    const body = (await this.call(
      `${this.config.depotServiceUrl}/api/v1/cashbook/internal/depot-costs?${this.q({ depotId, ...range })}`,
    )) as { cogsIdr?: unknown; opexIdr?: unknown } | null;
    return body && isNum(body.cogsIdr) && isNum(body.opexIdr) ? { cogsIdr: body.cogsIdr, opexIdr: body.opexIdr } : null;
  }

  async daysClosed(depotId: string, range: InstantRange): Promise<number | null> {
    const body = (await this.call(
      `${this.config.depotServiceUrl}/api/v1/reports/internal/governance?${this.q({ depotId, ...range })}`,
    )) as { daysClosed?: unknown } | null;
    return body && isNum(body.daysClosed) ? body.daysClosed : null;
  }

  async codDeposited(depotId: string, range: InstantRange): Promise<{ depositedIdr: number; expectedIdr: number } | null> {
    const body = (await this.call(
      `${this.config.deliveryServiceUrl}/api/v1/settlements/internal/deposited?${this.q({ depotId, ...range })}`,
    )) as { depositedIdr?: unknown; expectedIdr?: unknown } | null;
    return body && isNum(body.depositedIdr) && isNum(body.expectedIdr)
      ? { depositedIdr: body.depositedIdr, expectedIdr: body.expectedIdr }
      : null;
  }

  async cashFlow(depotId: string, month: string): Promise<{ netCashFlowIdr: number | null } | null> {
    const body = (await this.call(
      `${this.config.orderServiceUrl}/api/v1/reports/internal/depot-cash-flow?${this.q({ depotId, month })}`,
    )) as { netCashFlowIdr?: unknown } | null;
    if (!body) return null;
    if (body.netCashFlowIdr === null) return { netCashFlowIdr: null };
    return isNum(body.netCashFlowIdr) ? { netCashFlowIdr: body.netCashFlowIdr } : null;
  }
}
