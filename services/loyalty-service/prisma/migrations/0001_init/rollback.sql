-- Rollback for 0001_init.
DROP TABLE IF EXISTS "points_transactions";
DROP TABLE IF EXISTS "loyalty_accounts";
DROP TYPE IF EXISTS "PointsTxnType";
DROP TYPE IF EXISTS "MembershipTier";
