-- Manual rollback for 0003_courier_ledger (payout-service).
DROP TABLE IF EXISTS "courier_ledger_entries";
DROP TABLE IF EXISTS "courier_earning_rules";
DROP TYPE IF EXISTS "CourierLedgerEntryType";
