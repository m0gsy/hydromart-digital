-- Rollback for 20260804180000_order_number_sequence.
--
-- Safe: the sequence backs number GENERATION only, nothing references it, and already
-- issued order numbers are plain strings in the orders table. Rolling back means new
-- orders fall back to whatever code is deployed — deploy the previous image first, or
-- checkout will fail on a missing sequence.
DROP SEQUENCE IF EXISTS "order_number_seq";
