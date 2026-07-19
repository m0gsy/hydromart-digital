-- DB-5: add depotId foreign keys from the console/manager models to depots.
-- Config models CASCADE (deleting a depot removes its config rows); financial/audit
-- models (purchase orders, approvals, cashbook, disputes) RESTRICT so a depot with
-- money history cannot be deleted out from under its records.
--
-- These tables were created without a depot FK, so this is pure ADD CONSTRAINT. It
-- fails if any row holds a depotId absent from depots — that would be an existing
-- orphan and must be reconciled before applying (SELECT with a NOT IN check).

-- Config: ON DELETE CASCADE
ALTER TABLE "price_override_proposals" ADD CONSTRAINT "price_override_proposals_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "depot_targets" ADD CONSTRAINT "depot_targets_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_items" ADD CONSTRAINT "maintenance_items_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wholesale_tiers" ADD CONSTRAINT "wholesale_tiers_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "huddle_notes" ADD CONSTRAINT "huddle_notes_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_handovers" ADD CONSTRAINT "shift_handovers_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Financial/audit: ON DELETE RESTRICT
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_disputes" ADD CONSTRAINT "order_disputes_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
