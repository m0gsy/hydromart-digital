-- Rollback for 20261129100000_wa_consents. NOT lossless: the consent ledger and the opt-in codes are dropped.
-- Roll the code back first (the release before this one never reads these tables), then run this.
DROP TABLE IF EXISTS "wa_opt_in_codes";
DROP TABLE IF EXISTS "wa_consents";
