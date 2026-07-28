-- M29-10: make the tax rounding method a setting instead of an implicit Math.round.
-- Stored as TEXT (not a Postgres enum) so adding a convention later is an app-level
-- change, not a migration that cannot be rolled back.
ALTER TABLE "tax_settings"
  ADD COLUMN "taxRounding" TEXT NOT NULL DEFAULT 'HALF_UP';
