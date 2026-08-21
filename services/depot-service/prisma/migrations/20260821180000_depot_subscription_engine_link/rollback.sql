-- Rollback for 20260821180000_depot_subscription_engine_link.
-- LOSSY: discards which product each depot subscription was actually for, and the link to
-- the order-service subscription standing behind it. The engine-side subscriptions are NOT
-- removed by this — they live in another service and keep placing deliveries — so after
-- this runs the depot has standing orders it can no longer see the origin of. Export first:
--   SELECT id, "productId", "orderSubscriptionId" FROM subscriptions
--    WHERE "orderSubscriptionId" IS NOT NULL;
-- and cancel those engine-side subscriptions deliberately if that is what is intended.
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "productId",
  DROP COLUMN IF EXISTS "orderSubscriptionId";
