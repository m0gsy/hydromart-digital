-- Rollback for 20260718150000_one_default_payment_method.
--
-- Dropping this index is SAFE for the data but REMOVES A GUARD: it is the only thing
-- stopping a customer from ending up with two default payment methods under concurrency
-- (DB-2). Nothing has to be cleaned up to go back, but the defect it closed is open again
-- the moment this runs.
DROP INDEX IF EXISTS "saved_payment_methods_one_default_per_customer";
