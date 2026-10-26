/**
 * What a scheduled report renders.
 *
 * The three REVENUE_* groupings are the ones `hq/reports/export` already draws from real
 * endpoints. Every other value is a table the owning service answers on its own
 * `internal/report-table` route — so each entry here has a service that can actually fetch
 * it, which is the rule this enum exists to keep (a picker over data nothing can fetch is the
 * bug scheduled reports were built to fix).
 */
export enum ReportDataset {
  REVENUE_BY_DEPOT = 'REVENUE_BY_DEPOT',
  REVENUE_BY_PRODUCT = 'REVENUE_BY_PRODUCT',
  REVENUE_BY_METHOD = 'REVENUE_BY_METHOD',
  ORDERS_DETAIL = 'ORDERS_DETAIL',
  NEW_VS_REPEAT = 'NEW_VS_REPEAT',
  COD_UNSETTLED = 'COD_UNSETTLED',
  FAILED_DELIVERIES = 'FAILED_DELIVERIES',
  PROMO_COST = 'PROMO_COST',
  KASBON_BALANCE = 'KASBON_BALANCE',
  STOCK_LEVELS = 'STOCK_LEVELS',
  METER_READINGS = 'METER_READINGS',
}
