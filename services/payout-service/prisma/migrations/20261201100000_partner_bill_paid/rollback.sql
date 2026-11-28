-- Reverses 20261201100000_partner_bill_paid. THIS DROPS every due day and paid mark.
ALTER TABLE "partner_bills"
  DROP COLUMN IF EXISTS "paidRef",
  DROP COLUMN IF EXISTS "paidBy",
  DROP COLUMN IF EXISTS "paidOn",
  DROP COLUMN IF EXISTS "paidAt",
  DROP COLUMN IF EXISTS "dueOn";
