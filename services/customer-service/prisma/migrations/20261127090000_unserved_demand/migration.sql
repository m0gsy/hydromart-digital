-- RERUNNABLE: HD-20b (2026-11-27). New table, so its index is built here (empty, instant), not by
-- scripts/create-indexes.sh. Anonymous on purpose: no customer id, no address id, no coordinates and
-- no timestamp (a createdAt could be joined back to the address row it came from). Holds no personal data.
CREATE TABLE IF NOT EXISTS "unserved_demand" (
    "id" UUID NOT NULL,
    "monthKey" TEXT NOT NULL,
    "kecamatanCode" TEXT NOT NULL,
    "kelurahanCode" TEXT,
    "gridCell" TEXT NOT NULL,
    "distanceBand" TEXT NOT NULL,
    CONSTRAINT "unserved_demand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "unserved_demand_monthKey_idx" ON "unserved_demand"("monthKey");

-- The month a row was last recorded for this address's pin (one row per address per month).
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "unservedMonth" TEXT;
