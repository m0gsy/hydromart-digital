-- Rollback for 20260821140000_gallon_issue_deposit_decimal.
--
-- LOSSLESS TODAY, LOSSY LATER — and the difference is a date, not a flag.
--
-- DECIMAL -> INTEGER does NOT truncate, which is what the first draft of this comment said.
-- Measured on Postgres 16 instead of assumed: `20000.50` comes back as `20001`. It ROUNDS.
-- That is worse than truncation for money — the half rupiah is not lost, it is INVENTED,
-- and the ledger ends up holding a deposit nobody ever paid.
--
-- It is safe right now only because the column has never held a fractional value: the type
-- it is reverting to could not express one.
--
-- Before running this after any fractional deposit has been written, export the column:
--   SELECT id, "depositHeld" FROM gallon_issues WHERE "depositHeld" <> trunc("depositHeld");
-- If that returns rows, this rollback rewrites money. Decide, do not run it reflexively.
ALTER TABLE "gallon_issues"
  ALTER COLUMN "depositHeld" TYPE INTEGER,
  ALTER COLUMN "depositHeld" SET DEFAULT 0;
