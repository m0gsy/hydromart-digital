-- Rollback for 20260718160000_depot_fk_relations (DB-5).
--
-- Safe for the data — dropping a foreign key never deletes a row. It does REMOVE A GUARD:
-- without these, a deleted depot leaves orphaned config rows behind (the CASCADE half),
-- and a depot with purchase orders, approvals, cashbook entries or disputes can be deleted
-- out from under its own financial history (the RESTRICT half).
ALTER TABLE "order_disputes" DROP CONSTRAINT IF EXISTS "order_disputes_depotId_fkey";
ALTER TABLE "cashbook_entries" DROP CONSTRAINT IF EXISTS "cashbook_entries_depotId_fkey";
ALTER TABLE "approvals" DROP CONSTRAINT IF EXISTS "approvals_depotId_fkey";
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_depotId_fkey";

ALTER TABLE "shift_handovers" DROP CONSTRAINT IF EXISTS "shift_handovers_depotId_fkey";
ALTER TABLE "huddle_notes" DROP CONSTRAINT IF EXISTS "huddle_notes_depotId_fkey";
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_depotId_fkey";
ALTER TABLE "wholesale_tiers" DROP CONSTRAINT IF EXISTS "wholesale_tiers_depotId_fkey";
ALTER TABLE "maintenance_items" DROP CONSTRAINT IF EXISTS "maintenance_items_depotId_fkey";
ALTER TABLE "depot_targets" DROP CONSTRAINT IF EXISTS "depot_targets_depotId_fkey";
ALTER TABLE "shift_assignments" DROP CONSTRAINT IF EXISTS "shift_assignments_depotId_fkey";
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_depotId_fkey";
ALTER TABLE "incidents" DROP CONSTRAINT IF EXISTS "incidents_depotId_fkey";
ALTER TABLE "pricing_rules" DROP CONSTRAINT IF EXISTS "pricing_rules_depotId_fkey";
ALTER TABLE "price_override_proposals" DROP CONSTRAINT IF EXISTS "price_override_proposals_depotId_fkey";
