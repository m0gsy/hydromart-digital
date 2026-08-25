-- Reverses 20260825120000_otp_phone_change.
--
-- The column goes; the enum VALUE does not, and cannot. Postgres has no
-- `ALTER TYPE ... DROP VALUE`, and the only way to remove one is to rebuild the type and
-- every column using it — a table rewrite of `otp_tokens` to undo an addition that costs
-- nothing while unused. An unused enum value is inert: no row references it once the rows
-- that did are gone, and re-applying the migration finds it already there (the ADD VALUE
-- is `IF NOT EXISTS`).
--
-- Any PHONE_CHANGE challenge outstanding at rollback time becomes unverifiable, which is
-- the correct outcome: the endpoint that would have consumed it is gone with the code, and
-- the account's number is unchanged. A challenge nobody can spend is safer than one that
-- outlives the check around it.
DELETE FROM "otp_tokens" WHERE "purpose" = 'PHONE_CHANGE';
ALTER TABLE "otp_tokens" DROP COLUMN IF EXISTS "targetPhone";
