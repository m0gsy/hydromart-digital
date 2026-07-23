-- rollback 0006_courier_incentives
DROP TABLE "courier_incentive_tiers";
ALTER TABLE "courier_earning_rules" DROP COLUMN "monthlyTarget";

-- Postgres cannot drop an enum value, so the type is rebuilt without it. Tier bonuses are
-- the only rows that can hold it and they are meaningless once the feature is rolled back.
DELETE FROM "courier_ledger_entries" WHERE "type" = 'INCENTIVE';
ALTER TYPE "CourierLedgerEntryType" RENAME TO "CourierLedgerEntryType_old";
CREATE TYPE "CourierLedgerEntryType" AS ENUM ('EARNING', 'DEDUCTION', 'CASH_VARIANCE', 'WITHDRAWAL', 'ADJUSTMENT');
ALTER TABLE "courier_ledger_entries"
    ALTER COLUMN "type" TYPE "CourierLedgerEntryType"
    USING ("type"::text::"CourierLedgerEntryType");
DROP TYPE "CourierLedgerEntryType_old";
