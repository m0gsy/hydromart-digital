-- Additive gallery column: extra image URLs beyond the primary `imageUrl`.
-- Existing rows default to an empty array; the primary image is prepended
-- logically at read time, so no data backfill is required.
ALTER TABLE "products" ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
