-- HR-2: hr-service keeps a second audit trail, in its own database, that no retention policy
-- covered. Two years, the same window `audit_logs` (auth-service) has always had.
--
-- RERUNNABLE: inserted only when the dataset is absent, and the id is generated rather than
-- literal — a hand-picked one collided with a seeded row once already.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
SELECT gen_random_uuid()::text, 'hr_audit_logs', '2 tahun (jejak audit HR)', 730, 'HR', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "retention_policies" WHERE "dataset" = 'hr_audit_logs'
);
