-- Rollback 0010_employee_asset. Movements go first (they reference the asset), then the
-- assets, then the enums — Postgres refuses to drop a type a live column still uses.
--
-- This DOES destroy the hand-over history. There is nowhere else it is written down.
DROP TABLE IF EXISTS "asset_movements";
DROP TABLE IF EXISTS "employee_assets";

DROP TYPE IF EXISTS "AssetMovementKind";
DROP TYPE IF EXISTS "AssetStatus";
DROP TYPE IF EXISTS "AssetType";
