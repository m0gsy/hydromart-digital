-- Rollback for 0008_gallon_returns.
-- LOSSY AND FINANCIAL: every recorded gallon return is deleted, including the deposit
-- refunded against it. Export the table before running this — it is the evidence behind
-- money that has already left the drawer.
DROP TABLE IF EXISTS "gallon_returns";
DROP TYPE IF EXISTS "GallonCondition";
