-- Rollback for 20260729060000_data_subject_request.
--
-- Aborts if any request has already been decided: those rows ARE the legal record that
-- an export was handed over or an account was anonymised. Dropping them would destroy
-- the only proof the obligation was met, which is worse than a failed rollback.
DO $$
DECLARE
    decided BIGINT;
BEGIN
    SELECT count(*) INTO decided FROM "data_subject_requests" WHERE "status" <> 'PENDING';
    IF decided > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop data_subject_requests: % decided request(s) form the PDP audit record. Archive them first.',
            decided;
    END IF;
END
$$;

DROP TABLE "data_subject_requests";
