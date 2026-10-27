-- Undo of 20261026100000_report_datasets.
--
-- Postgres cannot drop a value from an enum, so schedules on the eight new datasets are
-- PAUSED and retyped to a dataset the old code knows. Deleting them is not an option: they
-- are the head-office user's own configuration (name, recipients, cadence).
--
-- Retyped to REVENUE_BY_DEPOT and disabled, so nothing runs until somebody re-enables and
-- picks the dataset they actually wanted. The unused enum labels are LEFT on the type;
-- old code never reads them.
UPDATE "scheduled_reports"
SET "enabled" = false, "dataset" = 'REVENUE_BY_DEPOT'
WHERE "dataset" IN (
  'ORDERS_DETAIL', 'NEW_VS_REPEAT', 'COD_UNSETTLED', 'FAILED_DELIVERIES',
  'PROMO_COST', 'KASBON_BALANCE', 'STOCK_LEVELS', 'METER_READINGS'
);
