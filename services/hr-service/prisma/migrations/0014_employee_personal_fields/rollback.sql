-- Reverse of 0014. Dropping the columns discards the identity data they hold — that is the
-- point of a rollback here, there is nowhere else to put it.

DROP INDEX IF EXISTS "employees_nik_key";

ALTER TABLE "employees"
  DROP COLUMN IF EXISTS "nik",
  DROP COLUMN IF EXISTS "birthDate",
  DROP COLUMN IF EXISTS "gender",
  DROP COLUMN IF EXISTS "address",
  DROP COLUMN IF EXISTS "ptkpStatus",
  DROP COLUMN IF EXISTS "contractEndDate";

DROP TYPE IF EXISTS "PtkpStatus";

DROP TYPE IF EXISTS "Gender";
