-- I1: the empty-gallon issue ledger is written by NOBODY except the manual returns
-- screen, so `depositHeld` is 0 for every depot in production. Every courier return then
-- refunds min(rate * qty, 0) = Rp0 and queues a GALLON_VARIANCE approval, because the
-- outstanding balance it measures against is an empty book.
--
-- Fulfilment has to write this ledger, and a completion fan-out is at-least-once: the
-- same order can arrive twice. `orderId` is what makes the write idempotent — a retry
-- collides with the unique index below instead of booking a second deposit, which would
-- inflate what the depot appears to hold and therefore what it later refunds.
--
-- Nullable, because a staff-entered issue has no order: only fulfilment-written rows
-- carry one, which is why the unique index is partial.
--
-- Written and nothing more in this release. The reader and the writer are I1b — the
-- schema rule ships a column one release before the code that uses it.
-- AlterTable
ALTER TABLE "gallon_issues" ADD COLUMN     "orderId" UUID;

-- On production, build this index with CREATE UNIQUE INDEX CONCURRENTLY *before* running
-- the migration (scripts/create-indexes.sh, audit H-39). This statement then finds it
-- already there and does nothing; on a fresh database it builds it outright.
--
-- TOTAL, not partial. A partial index (WHERE "orderId" IS NOT NULL) would be invisible to
-- Prisma — it cannot express a predicate on an index — and this repo's answer to that is
-- to leave the constraint out of the schema and catch violations by hand (see the H-11
-- note on ServiceSetting). None of that is needed here: Postgres treats every NULL as
-- distinct, so a total unique index already lets unlimited staff-entered rows carry a NULL
-- orderId while refusing a second row for the same order. Measured, not assumed.
CREATE UNIQUE INDEX IF NOT EXISTS "gallon_issues_orderId_key" ON "gallon_issues"("orderId");
