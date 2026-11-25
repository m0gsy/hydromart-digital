-- HD-6 H5: the AI read API's HQ commission reads ledger entries by (type, depotId, occurredAt window).
-- Nothing indexed depotId, so each read walked the owner index and filtered. On production the index is
-- built CONCURRENTLY before this migration (scripts/create-indexes.sh, audit H-39); this one is then a no-op.
CREATE INDEX IF NOT EXISTS "ledger_entries_depotId_occurredAt_idx" ON "ledger_entries"("depotId", "occurredAt");
