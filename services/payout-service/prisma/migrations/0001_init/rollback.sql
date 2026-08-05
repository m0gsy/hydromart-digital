-- Rollback for 0001_init (payout-service).
--
-- THIS EMPTIES THE SERVICE. It drops the franchise owner ledger and every withdrawal —
-- the complete record of money owed to and paid out to owners. There is no other copy:
-- commission entries are written here and nowhere else.
--
-- Only ever run this to unwind a failed FIRST install, against a database with no real
-- rows. On a live system, take a dump first and be certain you mean it.
DROP TABLE IF EXISTS "withdrawals";
DROP TABLE IF EXISTS "ledger_entries";
DROP TYPE IF EXISTS "WithdrawalStatus";
DROP TYPE IF EXISTS "LedgerEntryType";
