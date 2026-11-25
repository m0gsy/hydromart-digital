-- Rolls back 20261125110000_ledger_depot_occurred_idx (payout-service, HD-6 H5).
-- Only drops the index; no data is touched. The code before this release never needed it.
DROP INDEX IF EXISTS "ledger_entries_depotId_occurredAt_idx";
