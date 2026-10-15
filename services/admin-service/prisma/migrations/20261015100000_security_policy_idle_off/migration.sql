-- RERUNNABLE: both statements are idempotent (set a column to a constant, set a default), so a
-- retry after a deploy that died mid-migrate changes nothing a second time.
--
-- The idle-session limit now applies to head-office accounts only, and is OFF unless an
-- admin turns it on (0 = off). The old default of 15 was never a choice anyone made: it was
-- the column default, and once auth-service started reading it, every active session ended
-- at the 15-minute mark.
--
-- Any stored value predates this meaning, so it is neutralised rather than carried over: a
-- 15 saved by somebody who never meant to sign head office out every quarter of an hour
-- would otherwise start doing exactly that.
UPDATE "security_policy" SET "idleTimeoutMinutes" = 0;

ALTER TABLE "security_policy" ALTER COLUMN "idleTimeoutMinutes" SET DEFAULT 0;
