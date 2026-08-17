import { Inject, Injectable } from '@nestjs/common';

import { AccountNameResolver } from '@hydromart/platform';

import { denseDailySeries, toBusinessDay } from '../../domain/series';
import { DemandModel, resolveModel } from '../../domain/models';
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
  /** §G-3: who they are, so a re-engage list is people rather than eight hex characters. */
  customerName: string | null;
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
    @Inject(FORECAST_TOKENS.AccountNames) private readonly accountNames: AccountNameResolver,
  ) {}

  async ingest(cmd: IngestCommand): Promise<void> {
    if (await this.repo.hasIngested(cmd.orderId)) return; // idempotent short-circuit
    await this.repo.applyIngest(cmd, toBusinessDay(cmd.at, this.config.businessTimeZone)); // applyIngest is idempotent too (concurrency backstop)
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

    const today = toBusinessDay(params.now ?? new Date(), this.config.businessTimeZone);
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

    // PR-J: the model is a NAME now, and the name comes from a per-depot setting. The
    // comment that used to sit here promised this seam; a comment is not a seam, because
    // nothing could be run in the heuristic's place and therefore nothing could be
    // measured against it. Default is, and stays, the heuristic.
    const f = this.modelFor(params.depotId).predict(series, { horizonDays, maWindow });
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

    const today = toBusinessDay(params.now ?? new Date(), this.config.businessTimeZone);
    const fromDay = today - historyDays + 1;
    const toDay = today;

    const groups = await this.repo.listDepotProducts({ depotId: params.depotId, fromDay, toDay });
    const model = this.modelFor(params.depotId);

    const forecasts = groups.map((g) => {
      const series = denseDailySeries(
        g.rows.map((r) => ({ day: r.day, quantity: r.quantity })),
        { fromDay, toDay },
      );
      const f = model.predict(series, { horizonDays, maWindow });
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

    const today = toBusinessDay(params.now ?? new Date(), this.config.businessTimeZone);
    const fromDay = today - historyDays + 1;
    const toDay = today;

    // depotId: undefined -> all depots (global sum), null -> null-depot only, id -> that depot.
    const rows = await this.repo.findRevenueRows({ depotId: params.depotId, fromDay, toDay });
    // A global query returns a row per depot per day; denseDailySeries sums duplicate days.
    const series = denseDailySeries(
      rows.map((r) => ({ day: r.day, quantity: r.revenue })),
      { fromDay, toDay },
    );

    // Revenue reuses the demand engine, and therefore the depot's chosen model with it.
    const f = this.modelFor(params.depotId).predict(series, { horizonDays, maWindow });
    return {
      depotId: params.depotId ?? null,
      avgDaily: f.avgDaily,
      trendSlope: f.trendSlope,
      predictedDaily: f.predictedDaily,
      predictedTotal: f.predictedTotal,
      history: series,
    };
  }

  /**
   * One customer's churn band, for the depot CRM card that used to hardcode null (S2).
   *
   * Not "look them up in `churnList`": that list is the top-N most at-risk, so a customer
   * outside it would come back as LOW when the truth is "not in the sample". This scores
   * the one customer through the same pure `churnRisk()` the list uses, with the same
   * window and monetary reference — so the card and the at-risk queue can never disagree
   * about the same person.
   *
   * Null when they have never ordered. That is not low risk; it is no basis for a risk.
   */
  async churnFor(
    customerId: string,
    now?: Date,
  ): Promise<{ riskBand: ChurnBand; riskScore: number; daysSince: number } | null> {
    const row = await this.repo.findCustomerActivity(customerId);
    if (!row) return null;
    const risk = churnRisk(
      { lastOrderAt: row.lastOrderAt, orderCount: row.orderCount, totalSpent: row.totalSpent },
      now ?? new Date(),
      {
        windowDays: clamp(this.config.churnWindowDays, MIN_CHURN_WINDOW, MAX_CHURN_WINDOW),
        monetaryRef: this.config.churnMonetaryRef,
      },
    );
    return { riskBand: risk.riskBand, riskScore: risk.riskScore, daysSince: risk.daysSince };
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
          customerName: null as string | null,
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

    // §G-3, after the slice: the list is a call sheet, and a name is what makes it one.
    // Only the rows that survive the cut are looked up. Fail-soft — the risk ranking is
    // the answer, the names decorate it.
    const names = await this.accountNames(customers.map((c) => c.customerId));
    for (const c of customers) c.customerName = names.get(c.customerId) ?? null;

    return { customers };
  }

  /**
   * The depot's demand model. Unknown names resolve to the heuristic rather than throwing:
   * this reads configuration on a request path, and a typo in a per-depot setting must
   * degrade to the forecast everybody else gets, not take that depot's stock screen down.
   */
  private modelFor(depotId: string | null | undefined): DemandModel {
    return resolveModel(this.config.forecastModelForDepot(depotId));
  }

}
