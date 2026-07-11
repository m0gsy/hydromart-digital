-- Manual rollback for migration 0003_status_history_actor_text (order-service).
-- NOTE: fails if any row holds a non-UUID actor label (e.g. 'payment-service');
-- clear those rows first if you must revert.
ALTER TABLE "order_status_history" ALTER COLUMN "changedBy" TYPE UUID USING "changedBy"::uuid;
