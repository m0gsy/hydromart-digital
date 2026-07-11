-- Rollback 0003_churn_monetary
ALTER TABLE "customer_activity" DROP COLUMN "totalSpent";
