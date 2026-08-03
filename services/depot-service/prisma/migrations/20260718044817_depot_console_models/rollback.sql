-- Rollback for 20260718044817_depot_console_models.
--
-- LOSSY AND LARGE. This deletes the operator console's entire data set: incidents,
-- suppliers, purchase orders, approvals and the shift roster. Purchase orders and
-- approvals are financial and audit records — export them before running this.
--
-- Tables first, then the enums they used (an enum cannot be dropped while a column still
-- references it).
DROP TABLE IF EXISTS "shift_assignments";
DROP TABLE IF EXISTS "approvals";
DROP TABLE IF EXISTS "purchase_orders";
DROP TABLE IF EXISTS "suppliers";
DROP TABLE IF EXISTS "incidents";

DROP TYPE IF EXISTS "ShiftKind";
DROP TYPE IF EXISTS "ApprovalStatus";
DROP TYPE IF EXISTS "ApprovalType";
DROP TYPE IF EXISTS "PoStatus";
DROP TYPE IF EXISTS "IncidentStatus";
DROP TYPE IF EXISTS "IncidentSeverity";
DROP TYPE IF EXISTS "IncidentType";

-- The migration also dropped the database-side uuid defaults on five pre-existing tables,
-- to match Prisma's client-side @default(uuid()). Restoring them is harmless either way —
-- the application always supplies an id — and it puts those tables back exactly as they
-- were before this migration ran.
ALTER TABLE "franchise_applications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "gallon_issues" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "gallon_returns" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "price_override_proposals" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "pricing_rules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
