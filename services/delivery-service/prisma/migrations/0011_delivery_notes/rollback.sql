-- Rollback for 0011_delivery_notes.
-- LOSSY: the per-delivery note (the checkout instruction that reaches the courier) is
-- discarded.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "notes";
