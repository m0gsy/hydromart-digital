-- K4.2: what an agen pays stops being changeable in silence.
--
-- `reseller.service.ts` update() was a bare patch through to the profile row. Three things
-- were missing from it and all three cost the same person:
--
--   no trail        "who dropped Pak Budi to 0% last Tuesday" had no answer anywhere. The
--                   discount is money; an unsigned money change is the whole problem.
--   no schedule     every change was instant. There was no way to say "flat Rp5.000 mulai
--                   1 September" — you either changed it now or remembered to do it later.
--   no notice       nobody told the agen. They found out at the till, arguing with a
--                   cashier who was reading the correct new price off the correct screen.
--
-- One table answers all three, because a scheduled change IS an audit row that has not
-- happened yet:
--
--   appliedAt IS NULL   scheduled. effectiveAt is in the future; the sweep applies it.
--   appliedAt set       history. The profile moved at that moment.
--
-- One row per FIELD, not per request. "turun ke 5% dan dinonaktifkan" is two separate
-- facts about someone's income, and a history that merges them can answer neither
-- question cleanly. Values are TEXT so a boolean, a percent and a rupiah amount can share
-- one column pair without three nullable variants.
--
-- `changedBy` is NOT NULL on purpose. There is no such thing as a legitimate anonymous
-- change here — every writer already has an authenticated staff subject, and allowing null
-- would let a future caller skip the one field the table exists for.
--
-- Nothing backfills. Every change made before today happened without a record, and
-- inventing rows for them would be manufacturing an audit trail rather than starting one.

-- CreateTable
CREATE TABLE "reseller_price_changes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "changedBy" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reseller_price_changes_customerId_createdAt_idx" ON "reseller_price_changes"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reseller_price_changes_appliedAt_effectiveAt_idx" ON "reseller_price_changes"("appliedAt", "effectiveAt");
