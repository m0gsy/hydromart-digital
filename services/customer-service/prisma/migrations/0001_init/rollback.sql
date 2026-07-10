-- Manual rollback for migration 0001_init (customer-service).
DROP TABLE IF EXISTS "notification_preferences";
DROP TABLE IF EXISTS "addresses";
DROP TABLE IF EXISTS "customer_profiles";
DROP TYPE IF EXISTS "MembershipTier";
