-- Rolls back 20261108210000_bonus_rule_max_idr.
-- Drops the ceiling. Rules that had one then pay their full computed amount again.
ALTER TABLE "bonus_rules" DROP COLUMN IF EXISTS "maxIdr";
