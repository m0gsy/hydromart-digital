-- One open data-subject request per customer and type. `request()` read the open one and then
-- inserted, so two taps queued the same right twice (and an erasure could then run twice).
-- "Open" is PENDING or IN_PROGRESS (an approval that has claimed the request and is erasing).
--
-- Built ONLY when production data is already clean: a plain CREATE UNIQUE INDEX on dirty data
-- aborts `prisma migrate deploy` halfway and stalls every release behind it. Dirty data logs a
-- NOTICE and skips the index; the application still maps a unique violation to
-- DuplicateDataSubjectRequestError wherever the index exists. After a human resolves the
-- duplicates, re-run the statement by hand.
-- Index name for scripts/check-index-concurrency.mjs: data_subject_requests_one_open.
-- RERUNNABLE: guarded by IF NOT EXISTS and by the duplicate check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "data_subject_requests" WHERE "status" IN ('PENDING', 'IN_PROGRESS')
    GROUP BY "customerId", "type" HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'data_subject_requests_one_open skipped: duplicate open requests exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "data_subject_requests_one_open"
      ON "data_subject_requests" ("customerId", "type") WHERE "status" IN ('PENDING', 'IN_PROGRESS');
  END IF;
END $$;
