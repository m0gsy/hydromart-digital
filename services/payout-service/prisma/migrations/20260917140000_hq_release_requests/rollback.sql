-- Rollback for 20260917140000_hq_release_requests. Deploy the previous image first: this
-- release routes every HQ release through the table. Loses the request/approval trail.
DROP TABLE IF EXISTS "hq_release_requests";
DROP TYPE IF EXISTS "ReleaseRequestStatus";
