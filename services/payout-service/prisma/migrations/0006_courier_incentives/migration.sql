-- 0006_courier_incentives
-- New ledger kind for monthly tier bonuses. IF NOT EXISTS keeps a re-run safe; the value
-- is not used by any statement in this migration (Postgres forbids that in one transaction).
ALTER TYPE "CourierLedgerEntryType" ADD VALUE IF NOT EXISTS 'INCENTIVE' AFTER 'EARNING';

ALTER TABLE "courier_earning_rules"
    ADD COLUMN "monthlyTarget" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE "courier_incentive_tiers" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "deliveries" INTEGER NOT NULL,
    "bonus" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "courier_incentive_tiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_incentive_tiers_ruleId_deliveries_key"
    ON "courier_incentive_tiers"("ruleId", "deliveries");

ALTER TABLE "courier_incentive_tiers"
    ADD CONSTRAINT "courier_incentive_tiers_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "courier_earning_rules"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
