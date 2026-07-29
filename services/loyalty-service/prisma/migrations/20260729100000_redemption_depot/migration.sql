-- Per-depot reward hand-over: record WHERE the customer will collect, instead of leaving
-- the staff queue network-wide.
--
-- Nullable on purpose. Existing redemptions were made before the question was asked, and
-- there is no honest way to infer the answer — a customer's favourite depot is where they
-- usually order from, not where they will walk in to collect a reward. Those rows stay
-- null and remain visible to every depot, so nobody is turned away at the counter because
-- the system guessed wrong.
ALTER TABLE "reward_redemptions" ADD COLUMN "depotId" TEXT;

CREATE INDEX "reward_redemptions_depotId_status_createdAt_idx"
    ON "reward_redemptions" ("depotId", "status", "createdAt");
