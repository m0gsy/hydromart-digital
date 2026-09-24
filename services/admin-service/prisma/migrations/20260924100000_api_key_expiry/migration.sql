-- ADM-5: partner API keys never expired. A credential with no end outlives the integration
-- it was minted for, the person who asked for it, and the laptop it was pasted into.
--
-- Nullable, and existing keys are deliberately NOT given a date: silently expiring a
-- partner's live credential on deploy is an outage, not a fix. They are reported as
-- "no expiry" in the console and get one the next time they are rotated.
ALTER TABLE "api_keys" ADD COLUMN "expiresAt" TIMESTAMP(3);
