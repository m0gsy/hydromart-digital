-- M14-03: a redemption used to be a one-way door. It now has a lifecycle so points can
-- be returned when a customer changes their mind, and so a reward that was already
-- handed over can be told apart from one that was not.
ALTER TABLE "reward_redemptions"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "usedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Existing rows predate the lifecycle. They are left ACTIVE deliberately: marking them
-- USED would be a guess, and marking them CANCELLED would imply refunds that never
-- happened.
