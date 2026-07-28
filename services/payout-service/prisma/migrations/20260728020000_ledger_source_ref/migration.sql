-- Franchise revenue posting (design 6a). Order-service pushes a completed order here, so
-- the entry needs an idempotency key: a retried push must not credit the owner twice.
-- Mirrors courier_ledger_entries."sourceRef", which solved the same problem for couriers.
ALTER TABLE "ledger_entries" ADD COLUMN "sourceRef" TEXT;

-- Partial unique index: historical rows (and any manual adjustment) carry NULL and stay
-- unconstrained; every pushed entry is unique on its source reference.
CREATE UNIQUE INDEX "ledger_entries_sourceRef_key" ON "ledger_entries" ("sourceRef")
  WHERE "sourceRef" IS NOT NULL;
