-- Rollback for 20260901090000_order_address_province_optional.
--
-- NOT a plain reverse ALTER, and that is the whole content of this file.
--
-- Verified on postgres:16-alpine 2026-08-31: once a single row exists with a NULL province,
-- Postgres refuses to restore the constraint --
--
--   ERROR:  column "province" of relation "orders" contains null values
--
-- So undoing this means deciding what those rows should say, and only then re-adding NOT
-- NULL. The backfill below writes a marker rather than inventing a province, because a
-- guessed administrative region on a delivery address is worse than an obvious placeholder:
-- somebody can search for it later, and nobody can mistake it for what the customer typed.
--
-- Run it, read the counts it prints, and change the marker if your recovery calls for
-- something else.

UPDATE "orders" SET "province" = '(tidak diisi)' WHERE "province" IS NULL;
ALTER TABLE "orders" ALTER COLUMN "province" SET NOT NULL;

UPDATE "subscriptions" SET "province" = '(tidak diisi)' WHERE "province" IS NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "province" SET NOT NULL;
