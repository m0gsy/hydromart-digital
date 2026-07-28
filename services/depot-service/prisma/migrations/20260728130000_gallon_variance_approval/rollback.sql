-- HONEST LIMITATION: Postgres cannot DROP a value from an enum. Rolling this back
-- means recreating the type, which requires that NO row still uses 'GALLON_VARIANCE'.
-- Run the guard first; it aborts rather than destroying approval rows.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending FROM "approvals" WHERE "type" = 'GALLON_VARIANCE';
  IF offending > 0 THEN
    RAISE EXCEPTION 'Cannot roll back: % approval row(s) still use GALLON_VARIANCE. Decide or delete them first.', offending;
  END IF;
END $$;

ALTER TYPE "ApprovalType" RENAME TO "ApprovalType_old";
CREATE TYPE "ApprovalType" AS ENUM ('OPNAME_VARIANCE', 'DEPOSIT_REFUND', 'COD_VARIANCE');
ALTER TABLE "approvals"
  ALTER COLUMN "type" TYPE "ApprovalType" USING ("type"::text::"ApprovalType");
DROP TYPE "ApprovalType_old";
