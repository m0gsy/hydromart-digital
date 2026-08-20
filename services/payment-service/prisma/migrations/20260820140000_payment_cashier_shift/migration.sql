-- C2: a counter payment now names the DRAWER it landed in, not just the depot.
--
-- `sumDepotCash` filtered depot + CASH + PAID over a TIME WINDOW, and concurrent shifts at
-- one depot are supported. Two cashiers open at once therefore each claimed the whole
-- window: the same rupiah counted against both, one till short by the other's takings, and
-- the counter cash booked to the cash book twice.
--
-- Nullable and no foreign key: the shift lives in depot-service's database, so this is a
-- reference carried as data, the same way `depotId` already is on this table.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cashierShiftId" TEXT;

-- On production, build this index with CREATE INDEX CONCURRENTLY *before* running the
-- migration (scripts/create-indexes.sh, audit H-39). This statement then finds it already
-- there and does nothing; on a fresh database it builds it outright.
CREATE INDEX IF NOT EXISTS "payments_cashierShiftId_idx" ON "payments"("cashierShiftId");

-- No backfill statement, and that is the deliberate part.
--
-- The plan required measuring how many historical cash payments fall inside exactly one
-- shift before deciding what to do with the rest. Measured on production 2026-08-20:
-- 2 PAID cash payments, 1 recorded shift, 0 shifts open — and BOTH payments fall inside
-- that single shift's window. The ambiguous set is empty.
--
-- It is still not backfilled here, because the shifts live in ANOTHER database and a
-- migration that reaches across services is a worse precedent than the two rows are worth.
-- The reader's grandfather branch covers them instead: a payment with no shift id is
-- attributed by the old window rule, which for these two rows produces exactly the same
-- answer. See `sumDepotCash`.
