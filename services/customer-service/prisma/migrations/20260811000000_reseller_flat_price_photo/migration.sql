-- Depot SOP: a reseller may be priced at a flat rupiah-per-gallon instead of a percentage
-- (Rp5.000/galon), and their registration carries a photo.
-- Both additive with a default/null, so the column can ship one release ahead of the code
-- that reads it.
-- AlterTable
ALTER TABLE "reseller_profiles" ADD COLUMN     "flatGallonPriceIdr" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photoUrl" TEXT;
