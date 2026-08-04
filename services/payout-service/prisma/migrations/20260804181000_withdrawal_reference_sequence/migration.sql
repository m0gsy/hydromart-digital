-- H-13: withdrawal references were `WD-<date>-<Math.random 4 digits>` against a UNIQUE
-- column, shared by the franchise-owner and courier cash-out paths. Four digits collide
-- ~27% of days at this volume, and a collision is a 500 on a real cash-out request.
-- One sequence serves both tables — they only need the reference to be distinct.
CREATE SEQUENCE IF NOT EXISTS "withdrawal_reference_seq" AS bigint START WITH 100000 INCREMENT BY 1;
