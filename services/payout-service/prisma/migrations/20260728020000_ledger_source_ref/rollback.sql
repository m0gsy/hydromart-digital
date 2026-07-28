DROP INDEX IF EXISTS "ledger_entries_sourceRef_key";
ALTER TABLE "ledger_entries" DROP COLUMN IF EXISTS "sourceRef";
