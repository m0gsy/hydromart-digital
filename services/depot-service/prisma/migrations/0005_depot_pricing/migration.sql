-- Per-depot product price override (PRODUK lines). Null = use catalog base price.
-- Additive, nullable — existing rows keep catalog pricing until a price is set.
ALTER TABLE "inventory_items" ADD COLUMN "sellPrice" DECIMAL(12,2);
