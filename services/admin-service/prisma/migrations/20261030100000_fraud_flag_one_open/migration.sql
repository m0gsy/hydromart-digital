-- One OPEN fraud flag per entity. The daily scan read the open flags and then inserted, so a
-- scan racing another scan (or the internal ingest) raised the same case twice.
--
-- The index is partial: a REVIEWED / BLOCKED / CLEARED flag does not count, so the same
-- customer can be flagged again after a decision.
--
-- Built ONLY when production data is already clean. A plain CREATE UNIQUE INDEX on dirty data
-- aborts `prisma migrate deploy` halfway and stalls every release behind it. Here a dirty
-- table logs a NOTICE and skips the index: the application still handles a unique violation
-- (FraudFlagAlreadyOpenError) wherever the index exists. After the duplicates are resolved by
-- a human, re-run this statement by hand.
-- Index name for scripts/check-index-concurrency.mjs: fraud_flags_one_open_per_entity.
-- RERUNNABLE: guarded by IF NOT EXISTS and by the duplicate check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "fraud_flags" WHERE "status"::text = 'OPEN'
    GROUP BY "entityType", "entityRef" HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'fraud_flags_one_open_per_entity skipped: duplicate OPEN flags exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "fraud_flags_one_open_per_entity"
      ON "fraud_flags" ("entityType", "entityRef") WHERE "status" = 'OPEN';
  END IF;
END $$;
