-- 0003_churn_monetary: fold Monetary (the M) into RFM-lite churn.
-- Additive nullable-safe: lifetime spend defaults to 0 for existing rows.
ALTER TABLE "customer_activity" ADD COLUMN "totalSpent" INTEGER NOT NULL DEFAULT 0;
