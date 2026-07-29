-- Rollback for 20260729100000_redemption_depot.
--
-- Dropping the column loses which depot each customer chose to collect from. That is a
-- decision the customer made and the system cannot re-derive, so the rollback refuses
-- while any redemption is still waiting to be handed over — those are the ones where
-- losing the answer would strand a person at the wrong counter. Collected and cancelled
-- rows are history, so they do not block it.
DO $$
DECLARE
    waiting BIGINT;
BEGIN
    SELECT count(*) INTO waiting
    FROM "reward_redemptions"
    WHERE "depotId" IS NOT NULL AND "status" = 'ACTIVE';

    IF waiting > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop reward_redemptions.depotId: % redemption(s) are still waiting for collection at a chosen depot.',
            waiting;
    END IF;
END
$$;

DROP INDEX "reward_redemptions_depotId_status_createdAt_idx";
ALTER TABLE "reward_redemptions" DROP COLUMN "depotId";
