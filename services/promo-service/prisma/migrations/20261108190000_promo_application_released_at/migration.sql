-- RERUNNABLE: when a promotion's application was handed back because its order was voided or
-- cancelled (PLP-02). Nullable and additive: every existing row is NULL = still counted.
ALTER TABLE "promo_applications" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
