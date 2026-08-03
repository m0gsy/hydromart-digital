-- Counter void: a sale that happened at the till and was reversed the same day.
--
-- A new terminal status rather than reusing CANCELLED. CANCELLED means an order that never
-- happened; reporting, revenue and the day's cashbook all have to be able to tell the two
-- apart, and no historical row is reinterpreted by adding a value nothing yet uses.
ALTER TYPE "OrderStatus" ADD VALUE 'VOIDED';

ALTER TABLE "orders" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "voidReason" TEXT;
