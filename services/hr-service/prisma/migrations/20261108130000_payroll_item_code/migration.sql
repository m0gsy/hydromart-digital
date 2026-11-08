-- RERUNNABLE: explicit marker for statutory payslip lines (HR-05). Nullable and additive:
-- slips written before this release keep NULL and are read by their labels as before.
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "code" TEXT;
