-- Rollback for 20261129100100_wa_messages. NOT lossless: the outbound log and the inbound dedupe keys are dropped.
-- Roll the code back first, then run this.
DROP TABLE IF EXISTS "wa_inbound_events";
DROP TABLE IF EXISTS "wa_messages";
