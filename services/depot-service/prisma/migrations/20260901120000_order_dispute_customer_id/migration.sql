-- RERUNNABLE: every statement is IF NOT EXISTS / IF EXISTS, so re-running after a failed
-- deploy is a no-op rather than a second column or a second index.
--
-- UU PDP item 13: `order_disputes` had no way to say WHOSE dispute it is.
--
-- docs/AUDIT_L3.md §4.2 counted 18 rows holding `customerName` — a snapshot of a person's
-- name, taken in a service that has no other reason to know it — and the erasure registry
-- in auth-service reports the dataset UNENFORCED for exactly one reason: matching a
-- deletion request by NAME would erase the disputes of everybody who happens to share it.
--
-- This is the column half, and it ships ALONE. Nothing reads it in this release: the
-- erasure executor that will match on it comes one release later, after this column exists
-- on the live database. A column and the code that reads it in one release is the shape
-- that turns a slow migration into an outage.
--
-- NULLABLE, and it stays nullable. Existing rows have no id to backfill from — the dispute
-- carries a free-text `orderRef` typed by staff, not an order relation — and a dispute
-- opened at the counter for a walk-in customer has no account behind it at all. A NULL here
-- means "we do not know who", which is the truth, and an erasure that matches on this
-- column will correctly skip those rows rather than guess.
ALTER TABLE "order_disputes"
  ADD COLUMN IF NOT EXISTS "customerId" UUID;

COMMENT ON COLUMN "order_disputes"."customerId" IS
  'UU PDP item 13: which account this dispute belongs to, so an erasure request can find it without matching on customerName. NULL = unknown (counter dispute, or a row from before this column existed).';

-- The index is NOT built here (audit H-39). A plain CREATE INDEX inside a migration takes an
-- ACCESS EXCLUSIVE lock and blocks every write to the table for the whole build; on a release
-- that runs before the service starts, that is the deploy hanging on a table the console
-- writes to. It is registered in scripts/create-indexes.sh instead, which builds it
-- CONCURRENTLY, out of band, and re-checks the end state.
--
-- Nothing needs it in this release anyway: no code reads the column yet. The executor that
-- will query on it lands one release later, by which time the index is in place.
