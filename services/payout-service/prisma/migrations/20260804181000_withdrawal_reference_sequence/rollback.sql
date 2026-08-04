-- Rollback for 20260804181000_withdrawal_reference_sequence.
--
-- Safe: nothing references the sequence and issued references are plain strings on the
-- withdrawal rows. Deploy the previous image before rolling this back, or every cash-out
-- request fails on a missing sequence.
DROP SEQUENCE IF EXISTS "withdrawal_reference_seq";
