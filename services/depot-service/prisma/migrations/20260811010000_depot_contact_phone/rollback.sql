-- Rollback for 20260811010000_depot_contact_phone.
-- LOSSY: each depot's own WhatsApp number is discarded and its operational messages
-- silently revert to the HQ ops number. Export the column before running this.
ALTER TABLE "depots" DROP COLUMN IF EXISTS "contactPhone";
