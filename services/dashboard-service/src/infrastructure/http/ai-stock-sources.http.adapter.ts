import { Injectable, Logger } from '@nestjs/common';

import { InstantRange } from '../../application/ports/ai-money-sources.port';
import {
  AiStockSourcesPort,
  FORECAST_HISTORY_DAYS,
  FORECAST_HORIZON_DAYS,
  MeterDayRow,
  OpenPurchaseRow,
  SalesForecastRow,
  StockLossRow,
  StockPositionRow,
} from '../../application/ports/ai-stock-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isList = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every((r) => r && typeof r === 'object');

/**
 * HD-6 H4: reads the stock, meter and forecast facts from depot-, order- and forecast-service with
 * the internal key. A failure, an unwired service, a row for a depot nobody asked about, or a shape
 * that is not the one expected is null: the metric then says belum_ada, never a partial sum.
 */
@Injectable()
export class AiStockSourcesHttpAdapter implements AiStockSourcesPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(AiStockSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async call(url: string): Promise<unknown | null> {
    const where = url.split('?')[0];
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': this.config.internalServiceKey, accept: 'application/json' },
        signal: AbortSignal.timeout(AiStockSourcesHttpAdapter.TIMEOUT_MS),
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

  /** The `items` of a depot-service answer, if every one is for a depot that was asked about. */
  private async items(path: string, depotIds: readonly string[], params: Record<string, string>): Promise<Record<string, unknown>[] | null> {
    const body = (await this.call(
      `${this.config.depotServiceUrl}/api/v1/internal/ai-stock/${path}?${this.q({ depotIds: depotIds.join(','), ...params })}`,
    )) as { items?: unknown } | null;
    const items = body?.items;
    if (!isList(items)) return null;
    const asked = new Set(depotIds);
    return items.every((r) => typeof r.depotId === 'string' && asked.has(r.depotId)) ? items : null;
  }

  async position(depotIds: readonly string[]): Promise<StockPositionRow[] | null> {
    const items = await this.items('position', depotIds, {});
    if (!items) return null;
    const ok = items.every(
      (r) =>
        isNum(r.lines) &&
        isNum(r.lowLines) &&
        isNum(r.outLines) &&
        isList(r.byType) &&
        r.byType.every((t) => typeof t.itemType === 'string' && isNum(t.availableUnits) && isNum(t.lines)),
    );
    return ok ? (items as unknown as StockPositionRow[]) : null;
  }

  private async losses(path: 'wastage' | 'opname', depotIds: readonly string[], range: InstantRange): Promise<StockLossRow[] | null> {
    const items = await this.items(path, depotIds, { ...range });
    if (!items) return null;
    const ok = items.every((r) => typeof r.itemType === 'string' && isNum(r.units) && isNumOrNull(r.valueIdr) && isNum(r.unpricedUnits));
    return ok ? (items as unknown as StockLossRow[]) : null;
  }

  wastage(depotIds: readonly string[], range: InstantRange): Promise<StockLossRow[] | null> {
    return this.losses('wastage', depotIds, range);
  }

  opname(depotIds: readonly string[], range: InstantRange): Promise<StockLossRow[] | null> {
    return this.losses('opname', depotIds, range);
  }

  async openPurchases(depotIds: readonly string[]): Promise<OpenPurchaseRow[] | null> {
    const items = await this.items('open-purchases', depotIds, {});
    return items && items.every((r) => isNum(r.orders) && isNum(r.valueIdr)) ? (items as unknown as OpenPurchaseRow[]) : null;
  }

  async meterDays(depotId: string, from: string, to: string): Promise<MeterDayRow[] | null> {
    const rows = await this.call(`${this.config.orderServiceUrl}/api/v1/reports/meter/${depotId}?${this.q({ from, to })}`);
    if (!isList(rows)) return null;
    const ok = rows.every(
      (r) =>
        typeof r.day === 'string' &&
        r.day >= from &&
        r.day <= to &&
        isNumOrNull(r.meterLiters) &&
        isNum(r.soldLiters) &&
        isNumOrNull(r.varianceLiters) &&
        isNumOrNull(r.varianceGallons) &&
        isNumOrNull(r.varianceIdr) &&
        isNumOrNull(r.roYieldPct),
    );
    return ok ? (rows as unknown as MeterDayRow[]) : null;
  }

  async salesForecast(depotId: string): Promise<SalesForecastRow | null> {
    const base = this.config.forecastServiceUrl;
    if (!base) return null;
    const body = (await this.call(
      `${base}/api/v1/forecast/sales?${this.q({ depotId, historyDays: String(FORECAST_HISTORY_DAYS), horizonDays: String(FORECAST_HORIZON_DAYS) })}`,
    )) as { depotId?: unknown; predictedDaily?: unknown; predictedTotal?: unknown } | null;
    if (!body || body.depotId !== depotId || !isNum(body.predictedTotal)) return null;
    const daily = body.predictedDaily;
    if (!Array.isArray(daily) || daily.length !== FORECAST_HORIZON_DAYS || !daily.every(isNum)) return null;
    return { predictedDaily: daily, predictedTotal: body.predictedTotal };
  }
}
