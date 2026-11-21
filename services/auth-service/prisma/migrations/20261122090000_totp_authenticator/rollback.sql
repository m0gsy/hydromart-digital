-- Reverses 20261122090000_totp_authenticator.
--
-- THIS DROPS DATA: every authenticator and every recovery code goes. After re-applying the
-- migration, everyone who had set one up sets it up again, and until then the four roles
-- that need one cannot sign in to the AI web. Nothing else reads these two tables.
--
-- The OtpPurpose value stays, as in 20260825120000_otp_phone_change: Postgres has no
-- `ALTER TYPE ... DROP VALUE`, an unused value is inert, and the migration's ADD VALUE is
-- `IF NOT EXISTS`. Outstanding TOTP_ENROLMENT challenges are deleted: the endpoint that
-- spends them is gone with the code.
DELETE FROM "otp_tokens" WHERE "purpose" = 'TOTP_ENROLMENT';
DROP TABLE IF EXISTS "totp_recovery_codes";
DROP TABLE IF EXISTS "totp_credentials";
