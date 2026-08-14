/**
 * Which revenue grouping a scheduled report renders.
 *
 * Exactly the three groupings `hq/reports/export` already draws from real endpoints —
 * order-service owns the first two, payment-service the third. A fourth option would be a
 * picker for data nothing can fetch, which is the shape of the bug this feature fixes.
 */
export enum ReportDataset {
  REVENUE_BY_DEPOT = 'REVENUE_BY_DEPOT',
  REVENUE_BY_PRODUCT = 'REVENUE_BY_PRODUCT',
  REVENUE_BY_METHOD = 'REVENUE_BY_METHOD',
}
