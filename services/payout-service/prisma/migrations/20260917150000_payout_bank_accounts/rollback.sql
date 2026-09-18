-- Rollback for 20260917150000_payout_bank_accounts. Deploy the previous image first: this
-- release refuses a withdrawal unless a VERIFIED row exists here.
DROP TABLE IF EXISTS "payout_bank_accounts";
DROP TYPE IF EXISTS "BankAccountStatus";
DROP TYPE IF EXISTS "PayoutSubjectType";
