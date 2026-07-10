-- Rollback for 0002_add_sale_movement.
-- Postgres cannot DROP an enum value in place, so recreate the type without
-- 'SALE'. Only safe when no rows use it: convert any SALE movements to
-- ADJUSTMENT first (both are signed stock corrections).

UPDATE "stock_movements" SET "type" = 'ADJUSTMENT' WHERE "type" = 'SALE';

ALTER TYPE "StockMovementType" RENAME TO "StockMovementType_old";
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'OPNAME');
ALTER TABLE "stock_movements"
  ALTER COLUMN "type" TYPE "StockMovementType" USING ("type"::text::"StockMovementType");
DROP TYPE "StockMovementType_old";
