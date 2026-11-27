-- Undoes 20261128090000_b2b_prospects. LOSSY: every B2B prospect, visit, import batch and the
-- do-not-contact list are dropped (the list is permanent by design: do NOT roll back in production
-- without exporting it, or suppressed businesses become importable again).
DROP TABLE IF EXISTS "b2b_prospect_visits";
DROP TABLE IF EXISTS "b2b_prospects";
DROP TABLE IF EXISTS "b2b_do_not_contact";
DROP TABLE IF EXISTS "b2b_import_batches";
DROP TYPE IF EXISTS "B2bVisitOutcome";
DROP TYPE IF EXISTS "B2bDncReason";
DROP TYPE IF EXISTS "B2bDncKind";
DROP TYPE IF EXISTS "B2bOwnerSource";
DROP TYPE IF EXISTS "B2bSource";
DROP TYPE IF EXISTS "B2bProspectStatus";
DROP TYPE IF EXISTS "B2bCategory";
