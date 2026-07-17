import { Inject, Injectable } from '@nestjs/common';

import { denseDailySeries, toUtcDay } from '../../domain/series';
import { forecastDemand } from '../../domain/forecast';
import { ChurnBand, churnRisk } from '../../domain/churn';
import {
  ForecastRepository,
  IngestCommand,
  ProductRefRecord,
} from '../ports/forecast.repository';
import { ForecastConfigService } from '../../config/forecast-config.service';
import { FORECAST_TOKENS } from '../tokens';

/** Single-product demand forecast + its history window (the `/demand` response). */
export type ForecastResult = {
  productId: string;
  name: string | null;
  sku: string | null;
  unit: string | null;
  avgDaily: number;
  trendSlope: number;
  predictedDaily: number[];
  predictedTotal: number;
  reorderSuggestion: number;
  confidence: number;
  history: number[];
};

/** Lean per-product row in a depot rollup (no predictedDaily/history — kept small). */
export type ForecastItem = {
  productId: string;
  name: string | null;
  sku: string | null;
  unit: string | null;
  avgDaily: number;
  trendSlope: number;
  predictedTotal: number;
  reorderSuggestion: number;
};

/** Daily-revenue forecast for a depot (or global): rupiah. */
export type SalesForecast = {
  depotId: string | null;
  avgDaily: number;
  trendSlope: number;
  predictedDaily: number[];
  predictedTotal: number;
  history: number[];
};

/** One at-risk customer row in the churn list. */
export type ChurnItem = {
  customerId: string;
  lastOrderAt: string;
  orderCount: number;
  daysSince: number;
  riskScore: number;
  riskBand: ChurnBand;
};

const DEFAULT_HISTORY_DAYS = 30;
const MIN_HISTORY_DAYS = 7;
const MAX_HISTORY_DAYS = 365;
const DEFAULT_HORIZON_DAYS = 7;
const MIN_HORIZON_DAYS = 1;
const MAX_HORIZON_DAYS = 90;
const MAX_MA_WINDOW = 14;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_CHURN_LIMIT = 50;
const MIN_CHURN_LIMIT = 1;
const MAX_CHURN_LIMIT = 200;
const MIN_CHURN_WINDOW = 7;
const MAX_CHURN_WINDOW = 180;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

@Injectable()
export class ForecastService {
  constructor(
    @Inject(FORECAST_TOKENS.Repository) private readonly repo: ForecastRepository,
    private readonly config: ForecastConfigService,
  ) {}

  async ingest(cmd: IngestCommand): Promise<void> {
    if (await this.repo.hasIngested(cmd.orderId)) return; // idempotent short-circuit
    await this.repo.applyIngest(cmd); // applyIngest is idempotent too (concurrency backstop)
  }

  async demand(params: {
    productId: string;
    depotId?: string | null;
    historyDays?: number;
    horizonDays?: number;
    now?: Date;
  }): Promise<ForecastResult> {
    const historyDays = clamp(params.historyDays ?? DEFAULT_HISTORY_DAYS, MIN_HISTORY_DAYS, MAX_HISTORY_DAYS);
    const horizonDays = clamp(params.horizonDays ?? DEFAULT_HORIZON_DAYS, MIN_HORIZON_DAYS, MAX_HORIZON_DAYS);
    const maWindow = Math.min(historyDays, MAX_MA_WINDOW);

    const today = toUtcDay(params.now ?? new Date());
    const fromDay = today - historyDays + 1;
    const toDay = today;

    // depotId: undefined -> all depots (global), null -> null-depot only, id -> that depot.
    const rows = await this.repo.findDemandRows({
      productId: params.productId,
      depotId: params.depotId,
      fromDay,
      toDay,
    });
    // A global query may return several depot rows per day; denseDailySeries sums duplicate days.
    const series = denseDailySeries(
      rows.map((r) => ({ day: r.day, quantity: r.quantity })),
      { fromDay, toDay },
    );

    // ponytail: ML re-forecaster seam — a future fitted model swaps in here (series -> forecast).
    const f = forecastDemand(series, { horizonDays, maWindow });
    const ref = (await this.repo.findRefs([params.productId]))[0];

    return {
      productId: params.productId,
      name: ref?.name ?? null,
      sku: ref?.sku ?? null,
      unit: ref?.unit ?? null,
      avgDaily: f.avgDaily,
      trendSlope: f.trendSlope,
      predictedDaily: f.predictedDaily,
      predictedTotal: f.predictedTotal,
      reorderSuggestion: f.reorderSuggestion,
      confidence: f.confidence,
      history: series,
    };
  }

  async depotRollup(params: {
    depotId: string;
    historyDays?: number;
    horizonDays?: number;
    limit?: number;
    now?: Date;
  }): Promise<ForecastItem[]> {
    const historyDays = clamp(params.historyDays ?? DEFAULT_HISTORY_DAYS, MIN_HISTORY_DAYS, MAX_HISTORY_DAYS);
    const horizonDays = clamp(params.horizonDays ?? DEFAULT_HORIZON_DAYS, MIN_HORIZON_DAYS, MAX_HORIZON_DAYS);
    const limit = clamp(params.limit ?? DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
    const maWindow = Math.min(historyDays, MAX_MA_WINDOW);

    const today = toUtcDay(params.now ?? new Date());
    const fromDay = today - historyDays + 1;
    const toDay = today;

    const groups = await this.repo.listDepotProducts({ depotId: params.depotId, fromDay, toDay });

    const forecasts = groups.map((g) => {
      const series = denseDailySeries(
        g.rows.map((r) => ({ day: r.day, quantity: r.quantity })),
        { fromDay, toDay },
      );
      // ponytail: same ML re-forecaster seam as demand().
      const f = forecastDemand(series, { horizonDays, maWindow });
      return { productId: g.productId, f };
    });

    const refs = await this.repo.findRefs(forecasts.map((x) => x.productId));
    const refById = new Map<string, ProductRefRecord>(refs.map((r) => [r.productId, r]));

    return forecasts
      .map(({ productId, f }) => {
        const ref = refById.get(productId);
        return {
          productId,
          name: ref?.name ?? null,
          sku: ref?.sku ?? null,
          unit: ref?.unit ?? null,
          avgDaily: f.avgDaily,
          trendSlope: f.trendSlope,
          predictedTotal: f.predictedTotal,
          reorderSuggestion: f.reorderSuggestion,
        };
      })
      .sort((a, b) => b.predictedTotal - a.predictedTotal || a.productId.localeCompare(b.productId))
      .slice(0, limit);
  }

  async salesForecast(params: {
    depotId?: string | null;
    historyDays?: number;
    horizonDays?: number;
    now?: Date;
  }): Promise<SalesForecast> {
    const historyDays = clamp(params.historyDays ?? DEFAULT_HISTORY_DAYS, MIN_HISTORY_DAYS, MAX_HISTORY_DAYS);
    const horizonDays = clamp(params.horizonDays ?? DEFAULT_HORIZON_DAYS, MIN_HORIZON_DAYS, MAX_HORIZON_DAYS);
    const maWindow = Math.min(historyDays, MAX_MA_WINDOW);

    const today = toUtcDay(params.now ?? new Date());
    const fromDay = today - historyDays + 1;
    const toDay = today;

    // depotId: undefined -> all depots (global sum), null -> null-depot only, id -> that depot.
    const rows = await this.repo.findRevenueRows({ depotId: params.depotId, fromDay, toDay });
    // A global query returns a row per depot per day; denseDailySeries sums duplicate days.
    const series = denseDailySeries(
      rows.map((r) => ({ day: r.day, quantity: r.revenue })),
      { fromDay, toDay },
    );

    // ponytail: same ML re-forecaster seam as demand() — revenue reuses the demand engine.
    const f = forecastDemand(series, { horizonDays, maWindow });
    return {
      depotId: params.depotId ?? null,
      avgDaily: f.avgDaily,
      trendSlope: f.trendSlope,
      predictedDaily: f.predictedDaily,
      predictedTotal: f.predictedTotal,
      history: series,
    };
  }

  async churnList(params: {
    depotId?: string | null;
    limit?: number;
    windowDays?: number;
    now?: Date;
  }): Promise<{ customers: ChurnItem[] }> {
    const windowDays = clamp(
      params.windowDays ?? this.config.churnWindowDays,
      MIN_CHURN_WINDOW,
      MAX_CHURN_WINDOW,
    );
    const limit = clamp(params.limit ?? DEFAULT_CHURN_LIMIT, MIN_CHURN_LIMIT, MAX_CHURN_LIMIT);
    const now = params.now ?? new Date();

    // Repo returns the oldest `limit` (index-ordered by lastOrderAt asc) — already the most at-risk.
    const rows = await this.repo.listCustomerActivity({ depotId: params.depotId, limit });

    const customers = rows
      .map((r) => {
        const risk = churnRisk(
          { lastOrderAt: r.lastOrderAt, orderCount: r.orderCount, totalSpent: r.totalSpent },
          now,
          { windowDays, monetaryRef: this.config.churnMonetaryRef },
        );
        return {
          customerId: r.customerId,
          lastOrderAt: r.lastOrderAt.toISOString(),
          orderCount: r.orderCount,
          daysSince: risk.daysSince,
          riskScore: risk.riskScore,
          riskBand: risk.riskBand,
        };
      })
      .sort(
        (a, b) =>
          b.riskScore - a.riskScore ||
          b.daysSince - a.daysSince ||
          a.customerId.localeCompare(b.customerId),
      )
      .slice(0, limit);

    return { customers };
  }
}
