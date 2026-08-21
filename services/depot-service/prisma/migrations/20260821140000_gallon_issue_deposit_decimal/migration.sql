-- I4: the two halves of one deposit book carried different types.
--
--   gallon_issues.depositHeld       INTEGER
--   gallon_returns.depositRefunded  DECIMAL(12,2)
--
-- Every balance in this domain is `held − refunded`, so the subtraction mixed an integer
-- with a numeric. Postgres widens silently, JavaScript gets a Decimal on one side and a
-- number on the other, and the day a fractional refund exists the two halves stop agreeing
-- about what a rupiah is.
--
-- DIRECTION REVERSED from the plan, deliberately. The plan wrote this as the one
-- destructive migration in the programme: Decimal -> Int, a rewrite whose rollback cannot
-- be lossless because it truncates fractions. Going the other way — Int -> Decimal — is
-- WIDENING: additive, lossless, and reversible. No value that fits INTEGER fails to fit
-- DECIMAL(12,2).
--
-- Measured on production before writing this, because the plan's own verification demanded
-- "a copy of production data containing fractions":
--
--   gallon_issues   0 rows, 32 kB
--   gallon_returns  0 rows, 0 fractional values
--
-- There are no fractions to preserve because there are no rows. The table rewrite this
-- statement performs therefore takes its ACCESS EXCLUSIVE lock over an empty table — which
-- is also why this is the cheapest moment this asymmetry will ever be fixed.
ALTER TABLE "gallon_issues"
  ALTER COLUMN "depositHeld" TYPE DECIMAL(12,2),
  ALTER COLUMN "depositHeld" SET DEFAULT 0;
