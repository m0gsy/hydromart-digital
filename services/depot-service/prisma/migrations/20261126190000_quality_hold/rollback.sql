-- Rollback for 20261129100000_quality_hold (HD-14).
-- NOT lossless: every hold, lab test and permit is dropped. Roll the code back first (the release
-- before this one never reads these tables), then run this.
DROP TABLE IF EXISTS "depot_quality_holds";
DROP TABLE IF EXISTS "depot_lab_tests";
DROP TABLE IF EXISTS "depot_permits";
DROP TYPE IF EXISTS "QualityHoldStatus";
DROP TYPE IF EXISTS "QualityHoldReason";
DROP TYPE IF EXISTS "LabTestKind";
DROP TYPE IF EXISTS "LabTestResult";
