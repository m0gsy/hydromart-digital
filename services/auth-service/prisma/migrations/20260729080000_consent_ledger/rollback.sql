-- Rollback for 20260729080000_consent_ledger.
--
-- Aborts if any customer-made decision exists. The backfilled rows are inferred and can
-- be recreated from `customers.createdAt`; a row a customer actually clicked (granting or
-- withdrawing MARKETING) cannot, and it is the evidence that the choice was honoured.
DO $$
DECLARE
    real_decisions BIGINT;
BEGIN
    SELECT count(*) INTO real_decisions
    FROM "consent_records"
    WHERE "source" <> 'registration-backfill';

    IF real_decisions > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop consent_records: % customer-made consent decision(s) would be destroyed. Archive them first.',
            real_decisions;
    END IF;
END
$$;

DROP TABLE "consent_records";
