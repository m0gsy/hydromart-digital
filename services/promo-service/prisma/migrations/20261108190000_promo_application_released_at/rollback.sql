-- Rolls back 20261108190000_promo_application_released_at.
-- Drops the marker. Usage and the PROMO_COST report then count released applications again,
-- which is how they behaved before the column existed.
ALTER TABLE "promo_applications" DROP COLUMN IF EXISTS "releasedAt";
