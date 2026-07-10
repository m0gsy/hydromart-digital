-- Idempotent order->inventory deduction. Add a nullable orderId to the movement
-- ledger (set only on SALE rows) and a unique (itemId, orderId) so a retried
-- order-COMPLETED can never double-deduct a depot's stock. Non-SALE movements
-- keep orderId NULL, and Postgres treats each NULL as distinct, so the constraint
-- only binds SALE rows. Additive, non-destructive.

ALTER TABLE "stock_movements" ADD COLUMN "orderId" UUID;

CREATE UNIQUE INDEX "stock_movements_itemId_orderId_key"
  ON "stock_movements" ("itemId", "orderId");
