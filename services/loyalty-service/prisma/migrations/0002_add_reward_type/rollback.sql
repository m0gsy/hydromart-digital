-- Rollback for 0002_add_reward_type.
-- Postgres cannot DROP a value from an enum in place, so we recreate the type
-- without 'REWARD'. This is only safe when no rows use it: convert any REWARD
-- ledger entries to ADJUST first (they are equivalent positive corrections).

UPDATE "points_transactions" SET "type" = 'ADJUST' WHERE "type" = 'REWARD';

ALTER TYPE "PointsTxnType" RENAME TO "PointsTxnType_old";
CREATE TYPE "PointsTxnType" AS ENUM ('EARN', 'EXPIRE', 'ADJUST');
ALTER TABLE "points_transactions"
  ALTER COLUMN "type" TYPE "PointsTxnType" USING ("type"::text::"PointsTxnType");
DROP TYPE "PointsTxnType_old";
