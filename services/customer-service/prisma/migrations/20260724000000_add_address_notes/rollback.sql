-- Rollback for 20260724000000_add_address_notes.
-- LOSSY: the delivery note a customer wrote on each address is discarded, and couriers
-- lose the landmark text with it.
ALTER TABLE "addresses" DROP COLUMN IF EXISTS "notes";
