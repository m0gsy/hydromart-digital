-- Reverses 20260803170000_outbox. Dropping the table discards any effects still owed —
-- check for PENDING rows before running this, or a depot's stock and an owner's ledger
-- stay permanently short of a completed order.

DROP TABLE IF EXISTS "outbox_messages";
