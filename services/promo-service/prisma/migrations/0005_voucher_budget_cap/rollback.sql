-- Rollback for 0005_voucher_budget_cap.
--
-- LOSSY AND SPEND-AFFECTING: the total rupiah budget cap on each voucher is discarded, so
-- every capped campaign becomes uncapped. Record the caps before running this — the next
-- redemption sweep has nothing left to stop it.
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "budgetCap";
