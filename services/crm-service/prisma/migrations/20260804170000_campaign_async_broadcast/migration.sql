-- B-17: the broadcast moves off the HTTP request and onto a resumable sweep.
--
-- SENDING is the claim: a sweep moves a batch of recipients PENDING -> SENDING in one
-- conditional write, so a second tick cannot pick up the same rows and message a real
-- customer twice. The recipient table IS the queue — no broker, no new dependency.
ALTER TYPE "RecipientStatus" ADD VALUE IF NOT EXISTS 'SENDING';

-- The sweep's own query shape: "campaigns that are still SENDING", ordered oldest first.
-- Without it the sweep sequentially scans the whole campaign table every two minutes.
CREATE INDEX IF NOT EXISTS "campaigns_status_createdAt_idx"
  ON "campaigns" ("status", "createdAt");
