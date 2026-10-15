-- Rollback for 20261016100000_drop_dead_feature_flags: puts the two seed rows back with
-- the values the seed shipped. Idempotent (ON CONFLICT on the unique key).
INSERT INTO "feature_flags" ("id", "key", "label", "description", "state", "rolloutPct", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'payments.virtual_account', 'Virtual Account payments', 'Per-bank VA at checkout', 'ROLLOUT', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'delivery.live_tracking', 'Courier live tracking', 'Real-time courier position map', 'ACTIVE', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
