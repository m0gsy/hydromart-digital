-- Rollback for 20261129100300_wa_retention: the three WhatsApp datasets lose their policy rows.
DELETE FROM "retention_policies" WHERE "dataset" IN ('wa_messages', 'wa_inbound_events', 'wa_consents');
