-- AlterTable: changedBy records the actor of a status change, which may be a user
-- id (UUID) or a system service label (e.g. 'payment-service' for the settled-
-- payment auto-confirm). Widen from uuid to text so non-UUID actors are accepted.
ALTER TABLE "order_status_history" ALTER COLUMN "changedBy" TYPE TEXT USING "changedBy"::text;
