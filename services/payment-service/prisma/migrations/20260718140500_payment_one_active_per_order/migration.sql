-- Audit DB-1: enforce "at most one active (PENDING/PAID) payment per order" at the
-- database, closing the check-then-act race in PaymentService.initiate(). Prisma
-- cannot express a partial unique index in schema.prisma, so it is hand-authored here.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_one_active_per_order"
  ON "payments"("orderId")
  WHERE "status" IN ('PENDING', 'PAID');
