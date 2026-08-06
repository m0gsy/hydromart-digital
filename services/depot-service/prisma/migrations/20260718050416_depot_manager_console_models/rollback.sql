-- Rollback for 20260718050416_depot_manager_console_models.
--
-- LOSSY AND LARGE. This deletes the manager console's entire data set: depot targets,
-- cashbook, order disputes, maintenance items, wholesale tiers, subscriptions, huddle
-- notes and shift handovers.
--
-- Two of these are not recoverable from anywhere else. The CASHBOOK is the depot's money
-- record, and SUBSCRIPTIONS are live recurring orders — dropping that table stops every
-- customer's standing delivery with no trace of what they had signed up for. Export both
-- before running this.
DROP TABLE IF EXISTS "shift_handovers";
DROP TABLE IF EXISTS "huddle_notes";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "wholesale_tiers";
DROP TABLE IF EXISTS "maintenance_items";
DROP TABLE IF EXISTS "order_disputes";
DROP TABLE IF EXISTS "cashbook_entries";
DROP TABLE IF EXISTS "depot_targets";

DROP TYPE IF EXISTS "SubscriptionStatus";
DROP TYPE IF EXISTS "SubscriptionCadence";
DROP TYPE IF EXISTS "MaintenanceStatus";
DROP TYPE IF EXISTS "DisputeResolution";
DROP TYPE IF EXISTS "DisputeStatus";
DROP TYPE IF EXISTS "DisputeCategory";
DROP TYPE IF EXISTS "CashDirection";
