import { InstantRange } from './ai-money-sources.port';

/** depot-service `internal/ai-stock/position`: one depot's visible stock lines, now. */
export interface StockPositionRow {
  depotId: string;
  lines: number;
  lowLines: number;
  outLines: number;
  byType: { itemType: string; availableUnits: number; lines: number }[];
}

/** depot-service `internal/ai-stock/wastage` and `/opname`: units and purchase-price value per depot and type. */
export interface StockLossRow {
  depotId: string;
  itemType: string;
  units: number;
  valueIdr: number | null;
  unpricedUnits: number;
}

export interface OpenPurchaseRow {
  depotId: string;
  orders: number;
  valueIdr: number;
}

/** One day of order-service `reports/meter/:depotId`. */
export interface MeterDayRow {
  day: string;
  meterLiters: number | null;
  soldLiters: number;
  varianceLiters: number | null;
  varianceGallons: number | null;
  varianceIdr: number | null;
  /** Raw-water litres of the day; null unless both source readings exist. */
  sourceLiters: number | null;
  roYieldPct: number | null;
}

/** forecast-service `forecast/sales` for one depot: rupiah per day ahead. */
export interface SalesForecastRow {
  predictedDaily: number[];
  predictedTotal: number;
}

/** What the sales forecast was asked over, so the answer can say it. */
export const FORECAST_HISTORY_DAYS = 30;
export const FORECAST_HORIZON_DAYS = 7;

/**
 * HD-6 H4: the stock, meter and forecast facts the AI read API reads. Every method answers `null`
 * when its service cannot (down, unwired, refused, or an answer that is not whole), so a metric
 * says belum_ada and never a partial sum. Callers pass only the depots they may read.
 */
export interface AiStockSourcesPort {
  /** At most 100 depots per call. */
  position(depotIds: readonly string[]): Promise<StockPositionRow[] | null>;
  wastage(depotIds: readonly string[], range: InstantRange): Promise<StockLossRow[] | null>;
  opname(depotIds: readonly string[], range: InstantRange): Promise<StockLossRow[] | null>;
  openPurchases(depotIds: readonly string[]): Promise<OpenPurchaseRow[] | null>;
  /** One depot, days `from`..`to` (`YYYY-MM-DD`, WIB, at most 92 of them); only days with a reading are returned. */
  meterDays(depotId: string, from: string, to: string): Promise<MeterDayRow[] | null>;
  /** One depot, the next 7 days from today. */
  salesForecast(depotId: string): Promise<SalesForecastRow | null>;
}
