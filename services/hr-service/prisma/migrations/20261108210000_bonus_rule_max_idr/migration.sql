-- RERUNNABLE: an optional per-rule ceiling on what one bonus rule may pay (HR-08). Nullable and
-- additive; NULL (every existing rule) means no ceiling, exactly as before. No cap value is set here.
ALTER TABLE "bonus_rules" ADD COLUMN IF NOT EXISTS "maxIdr" DECIMAL(14,2);
