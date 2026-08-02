-- Numeric fill volume + an explicit galon flag, replacing the label-string
-- heuristics that order-service used to guess "is this a galon" from `unit`
-- and `name` (see order-service pricing.galonQuantity / report isGallon).
--
-- `volumeMl` is deliberately NOT backfilled from the unit label: parsing
-- "Galon 19L" back into 19000 is exactly the string fragility this column
-- exists to remove. It stays NULL until a human fills it in, and NULL lines
-- are reported as unmeasured rather than counted as zero litres.
ALTER TABLE "products" ADD COLUMN "volumeMl" INTEGER;
ALTER TABLE "products" ADD COLUMN "isGallon" BOOLEAN NOT NULL DEFAULT false;

-- `isGallon` IS backfilled, from the unit prefix only:
--   pricing.galonQuantity -> unit.trim().toLowerCase().startsWith('galon')
--
-- The other predicate this replaces was broader (report's /galon/i over unit OR
-- name), and the two were never equivalent: a "Tutup Galon" (gallon CAP) sold by
-- the 'Pak' matched the report test but not the fee test. Backfilling the union
-- would start charging the per-galon delivery fee on caps, so the prefix rule —
-- the one attached to customer money — is the one preserved exactly.
UPDATE "products"
SET "isGallon" = true
WHERE lower(btrim("unit")) LIKE 'galon%';
