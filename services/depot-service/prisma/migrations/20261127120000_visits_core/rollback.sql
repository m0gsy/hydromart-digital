-- Rollback for 20261127120000_visits_core (HD-15B PR-4).
-- NOT lossless: every visit, its checklist answers, findings and follow-ups are dropped. The photos
-- stay in the private bucket under visits/ (orphans) and have to be cleared there if they matter.
-- Roll the code back first (the release before this one never reads these tables), then run this.
DROP TABLE IF EXISTS "visit_items";
DROP TABLE IF EXISTS "visits";
DROP TYPE IF EXISTS "FollowUpStatus";
DROP TYPE IF EXISTS "VisitItemResult";
DROP TYPE IF EXISTS "VisitStatus";
