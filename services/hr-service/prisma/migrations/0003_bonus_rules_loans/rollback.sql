-- Rollback for 0003_bonus_rules_loans.
-- LOSSY AND FINANCIAL: every employee loan (including outstanding balances the company is
-- still collecting) and every bonus rule is deleted. Export both before running this.
DROP TABLE IF EXISTS "loans";
DROP TABLE IF EXISTS "bonus_rules";
