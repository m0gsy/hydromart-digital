-- Rolls back 20261109100000_gallon_issue_idempotency_key.
-- Drops the key and its index. A double-tapped manual issue can again be booked twice.
DROP INDEX IF EXISTS "gallon_issues_depotId_idempotencyKey_key";
ALTER TABLE "gallon_issues" DROP COLUMN IF EXISTS "idempotencyKey";
