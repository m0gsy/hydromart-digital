-- Counter sales: which depot's drawer the money went into.
--
-- Nullable on purpose. Every payment written before this migration, and every delivery
-- order's payment after it, has no depot of its own — the order carries that. Backfilling
-- a guess here would make the network's cash look like it sat in one depot's till.
ALTER TABLE "Payment" ADD COLUMN "depotId" UUID;

-- Closing a shift sums one depot's PAID cash over the shift window.
CREATE INDEX "Payment_depotId_method_status_paidAt_idx"
  ON "Payment" ("depotId", "method", "status", "paidAt");
