-- RERUNNABLE: idempotent clean-up; trimming a city that is already trimmed changes nothing.
-- A city stored with a stray space ("Bandung ") was a second city in every segment, list and
-- report. New writes are trimmed by AddressService; this brings the rows written before it in line.
UPDATE "addresses" SET "city" = BTRIM("city") WHERE "city" <> BTRIM("city");
