-- Reverses 20261126200000_legal_entity_bank_account. Drops the account head office entered; a
-- partner bill cannot be approved again until it is re-entered.
ALTER TABLE "legal_entities"
  DROP COLUMN IF EXISTS "bankAccountHolder",
  DROP COLUMN IF EXISTS "bankAccountNumber",
  DROP COLUMN IF EXISTS "bankName";
