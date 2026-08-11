-- Depot SOP: the twice-daily sales update is addressed to the DEPOT, not to a customer,
-- and a depot had no phone number of its own. Nullable: every existing depot keeps
-- falling back to the HQ ops number until someone fills this in.
-- AlterTable
ALTER TABLE "depots" ADD COLUMN     "contactPhone" TEXT;
