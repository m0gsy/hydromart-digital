-- HD-12/HD-13: WhatsApp number 1 keeps three datasets in crm-service. Windows are defaults for the lawyer list
-- (docs/LEGAL_OPEN_ITEMS.md), not legal advice:
--   wa_messages        180 days: long enough to reconcile Meta's invoice, then the phone number goes.
--   wa_inbound_events  30 days: pure webhook dedupe keys, no body.
--   wa_consents        3 years after the newest row of that phone (1095 days). A number whose newest row is a
--                      STOP is never purged (the do-not-contact rule), which the crm purge route enforces.
-- Policy rows only: the crm purge route arrives with the sender release, and until then these read UNENFORCED
-- on purpose (the tables are empty). Registering an executor for a route that does not exist would make every
-- sweep FAIL instead.
--
-- RERUNNABLE: each row is inserted only when its dataset is absent, and the id is generated rather than literal.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
SELECT gen_random_uuid()::text, v.dataset, v.label, v.days, 'OPERATIONAL', NOW()
FROM (VALUES
  ('wa_messages', '180 hari (log pesan WhatsApp)', 180),
  ('wa_inbound_events', '30 hari (kunci dedupe webhook WhatsApp)', 30),
  ('wa_consents', '3 tahun sejak catatan terakhir (bukti izin WhatsApp; nomor yang terakhir STOP tidak dihapus)', 1095)
) AS v(dataset, label, days)
WHERE NOT EXISTS (
  SELECT 1 FROM "retention_policies" r WHERE r."dataset" = v.dataset
);
