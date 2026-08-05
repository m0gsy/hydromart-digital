-- Rollback for 0002_product_images.
-- LOSSY: every product's image list is discarded. The files stay in the bucket, but
-- nothing in the database points at them and the catalog renders with no photos.
ALTER TABLE "products" DROP COLUMN IF EXISTS "images";
