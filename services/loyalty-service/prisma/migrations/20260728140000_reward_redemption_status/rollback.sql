-- Dropping these columns loses the record of which rewards were collected and which
-- redemptions were refunded. The points already returned by a cancellation stay
-- returned — the ledger entries are separate rows and are NOT undone here.
ALTER TABLE "reward_redemptions"
  DROP COLUMN "status",
  DROP COLUMN "usedAt",
  DROP COLUMN "cancelledAt";
