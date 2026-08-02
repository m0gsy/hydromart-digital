-- Water-meter reconciliation (depot daily meter vs litres accounted for by sales).
--
-- Part 1: snapshot columns on the order line, alongside unitPrice/productName/sku.
ALTER TABLE "order_items" ADD COLUMN "volumeMl" INTEGER;
ALTER TABLE "order_items" ADD COLUMN "isGallon" BOOLEAN NOT NULL DEFAULT false;

-- Backfill `isGallon` from the UNIT PREFIX only, matching pricing.galonQuantity:
--   pricing.galonQuantity -> unit.trim().toLowerCase().startsWith('galon')
--
-- The other predicate this column replaces was broader:
--   report.isGallon       -> /galon/i on unit OR productName
-- and the two were never equivalent. A line like unit 'Pak' / product 'Tutup Galon'
-- (a gallon CAP) matched the report test but not the fee test. Backfilling with the
-- union would have started charging the per-galon delivery fee on caps — a billing
-- change on real customers — so the money path wins and the prefix rule is kept.
--
-- Known, deliberate consequence: depot report gallon counts drop for any product
-- whose NAME says galon while its unit does not (caps, seals, dispenser parts).
-- Those were never galons of water delivered; the old count was inflated.
UPDATE "order_items"
SET "isGallon" = true
WHERE lower(btrim("unit")) LIKE 'galon%';

-- `volumeMl` is deliberately left NULL: past orders have no trustworthy volume, and
-- guessing one from the unit label is the string fragility this column removes. Those
-- lines surface as `unmeasuredLines` in the reconciliation instead of reading as 0 L.

-- Part 2: the reading itself.
CREATE TABLE "meter_readings" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "readingDate" DATE NOT NULL,
    "openingM3" DECIMAL(12,3) NOT NULL,
    "closingM3" DECIMAL(12,3),
    "sourceOpeningM3" DECIMAL(12,3),
    "sourceClosingM3" DECIMAL(12,3),
    "openedBy" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" UUID,
    "closedAt" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meter_readings_depotId_readingDate_key"
    ON "meter_readings"("depotId", "readingDate");
CREATE INDEX "meter_readings_depotId_readingDate_idx"
    ON "meter_readings"("depotId", "readingDate");
