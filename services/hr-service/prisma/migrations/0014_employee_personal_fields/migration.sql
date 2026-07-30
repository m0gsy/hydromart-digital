-- Personal-file fields the employee form and the bulk import were both missing: identity
-- (NIK/birth date/gender/address), the PPh 21 class, and the end of a fixed-term contract.
--
-- Every column is nullable and nothing is backfilled: an existing row genuinely does not
-- know these values, and a guessed NIK is worse than an empty one.

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

CREATE TYPE "PtkpStatus" AS ENUM ('TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3');

ALTER TABLE "employees"
  ADD COLUMN "nik"             TEXT,
  ADD COLUMN "birthDate"       DATE,
  ADD COLUMN "gender"          "Gender",
  ADD COLUMN "address"         TEXT,
  ADD COLUMN "ptkpStatus"      "PtkpStatus",
  ADD COLUMN "contractEndDate" DATE;

-- Partial-by-nature: Postgres allows many NULLs in a unique index, so employees without a
-- recorded NIK do not collide with each other.
CREATE UNIQUE INDEX "employees_nik_key" ON "employees"("nik");
