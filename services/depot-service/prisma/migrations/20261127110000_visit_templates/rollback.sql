-- Rollback for 20261127110000_visit_templates (HD-15B PR-3).
-- NOT lossless: every template and its checklist lines are dropped.
-- Roll the code back first (the release before this one never reads these tables), then run this.
DROP TABLE IF EXISTS "visit_template_items";
DROP TABLE IF EXISTS "visit_templates";
