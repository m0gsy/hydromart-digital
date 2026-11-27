-- AREA-1b: B2B prospects (businesses a depot could sell gallons to) carry a business name, a phone, a contact
-- person, an address and an exact pin. 12 months without salesperson activity, owner decision 27 Nov 2026:
-- unconverted rows are deleted, converted ones are anonymised (they stay as counts), a do-not-contact row goes
-- 12 months after its wipe. The do-not-contact LIST is permanent and is not covered here on purpose.
--
-- RERUNNABLE: inserted only when the dataset is absent, and the id is generated rather than literal.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
SELECT gen_random_uuid()::text, 'b2b_prospects', '12 bulan tanpa aktivitas (data prospek B2B)', 365, 'OPERATIONAL', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "retention_policies" WHERE "dataset" = 'b2b_prospects'
);
