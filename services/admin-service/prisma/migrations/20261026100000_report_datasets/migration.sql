-- Scheduled reports: eight more datasets beyond the three revenue groupings.
-- Additive only (ADD VALUE, the precedent of promo-service 0006_voucher_free_shipping): old
-- rows keep their dataset and old code never reads the new values, so a rebuild window with
-- mixed images is safe.
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'ORDERS_DETAIL';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'NEW_VS_REPEAT';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'COD_UNSETTLED';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'FAILED_DELIVERIES';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'PROMO_COST';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'KASBON_BALANCE';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'STOCK_LEVELS';
ALTER TYPE "ReportDataset" ADD VALUE IF NOT EXISTS 'METER_READINGS';
