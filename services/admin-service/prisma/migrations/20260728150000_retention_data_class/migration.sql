-- M23-21: retention rows carried a window but no notion of WHAT the data is, so a purge
-- job had nothing to tell "delete after 90 days" apart from "must survive a tax audit".
-- TEXT rather than an enum so a new class needs no irreversible migration.
ALTER TABLE "retention_policies"
  ADD COLUMN "dataClass" TEXT NOT NULL DEFAULT 'OPERATIONAL';

-- Classify the seeded datasets and lift financial data to the 10-year floor.
UPDATE "retention_policies"
   SET "dataClass" = 'FINANCIAL',
       "windowDays" = 3650,
       "windowLabel" = '10 tahun (keuangan — dikecualikan dari purge)'
 WHERE "dataset" = 'orders_transactions';

UPDATE "retention_policies"
   SET "dataClass" = 'MARKETING'
 WHERE "dataset" = 'notifications_messages';

-- audit_logs and proof_of_delivery keep the OPERATIONAL default.

-- HR data has its own window and was never represented here at all.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
VALUES ('11111111-0000-4000-a000-000000000005', 'hr_employee_records', '5 tahun setelah berhenti', 1825, 'HR', NOW())
ON CONFLICT ("dataset") DO NOTHING;
