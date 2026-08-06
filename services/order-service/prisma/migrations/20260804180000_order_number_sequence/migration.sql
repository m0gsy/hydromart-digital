-- H-12: order numbers came from randomInt(0, 1e6). `orderNumber` is UNIQUE, so a
-- collision is a failed checkout, not a duplicate row — and at ~1,000 orders/day the
-- birthday bound makes that a near-daily event. A sequence removes the class of bug.
--
-- Started past any number a live database could already hold, so the first value this
-- hands out cannot equal a legacy random suffix minted for the same day.
CREATE SEQUENCE IF NOT EXISTS "order_number_seq" AS bigint START WITH 1000000 INCREMENT BY 1;
