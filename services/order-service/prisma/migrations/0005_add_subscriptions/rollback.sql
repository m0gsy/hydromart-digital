-- Rollback 0005_add_subscriptions
DROP TABLE IF EXISTS "subscriptions";
DROP TYPE IF EXISTS "SubscriptionStatus";
DROP TYPE IF EXISTS "SubscriptionFrequency";
