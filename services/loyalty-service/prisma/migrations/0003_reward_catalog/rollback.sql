-- Rollback for 0003_reward_catalog.

DROP TABLE IF EXISTS "reward_redemptions";
DROP TABLE IF EXISTS "reward_items";

-- Recreate PointsTxnType without 'REDEEM' (Postgres cannot drop an enum value in
-- place). Only safe when no rows use it: convert any REDEEM entries to ADJUST first
-- (both are signed corrections).
UPDATE "points_transactions" SET "type" = 'ADJUST' WHERE "type" = 'REDEEM';

ALTER TYPE "PointsTxnType" RENAME TO "PointsTxnType_old";
CREATE TYPE "PointsTxnType" AS ENUM ('EARN', 'EXPIRE', 'ADJUST', 'REWARD');
ALTER TABLE "points_transactions"
  ALTER COLUMN "type" TYPE "PointsTxnType" USING ("type"::text::"PointsTxnType");
DROP TYPE "PointsTxnType_old";
