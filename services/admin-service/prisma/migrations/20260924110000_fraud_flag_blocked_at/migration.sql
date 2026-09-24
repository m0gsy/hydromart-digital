-- ADM-8: whether THIS flag is the one that suspended the account.
--
-- Clearing reinstated whenever the flag currently read BLOCKED, which was wrong twice over:
-- an account held by two separate suspicions was released by resolving either of them, and
-- the ordinary path (block, mark reviewed, then clear) never reinstated at all — the account
-- stayed locked out with every flag against it resolved.
--
-- Backfilled for rows that are BLOCKED right now: those are exactly the flags currently
-- holding an account. `fraud_flags` carries only `createdAt` (no `updatedAt` — confirmed
-- against schema.prisma, not assumed), so that is the stamp used: the closest honest answer
-- to "when did this happen" for a decision nobody recorded a time for.
ALTER TABLE "fraud_flags" ADD COLUMN "blockedAt" TIMESTAMP(3);

UPDATE "fraud_flags" SET "blockedAt" = "createdAt" WHERE "status" = 'BLOCKED';
