-- K1.4: the phone number becomes changeable, which means it first becomes provable.
--
-- The number is the login identity — the whole of it. There is no password; whoever
-- receives the OTP on that number IS the account. And it could not be changed anywhere:
-- not in `/account/edit`, not in the app, not by the customer at all. A person who
-- changes SIM, loses a number, or mistypes one digit at sign-up had exactly one route
-- back into their own account, and it went through a depot.
--
-- Two schema facts are needed for a self-service change that is not a hijack:
--
--   PHONE_CHANGE   a purpose of its own. It cannot reuse LOGIN: a LOGIN code is delivered
--                  to the account's CURRENT number, and the entire point here is a code
--                  delivered to a number the account does not yet own. Sharing the purpose
--                  would mean a code issued for one of those could be spent on the other.
--   targetPhone    where the code was actually sent. This is the column that makes the
--                  confirm step safe: it reads the destination from here rather than from
--                  the request body. Taking it from the body would let a code that proves
--                  control of one number move the account onto a different one — the code
--                  only ever proves control of wherever it was delivered, and this is the
--                  only record of where that was.
--
-- Nullable, and null is the honest value for every challenge that already exists: a
-- REGISTRATION or LOGIN code goes to the account's own number, so there is no separate
-- destination to record. Backfilling it with `customer.phone` would invent a distinction
-- that does not exist and make "was this a phone change?" unanswerable.
--
-- No index. The confirm step reads the challenge by (customerId, purpose), which
-- `otp_tokens_customerId_purpose_idx` already covers; nothing looks a challenge up by the
-- number it was sent to, and adding an index on a column carrying phone numbers is a
-- lookup surface nobody asked for.

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PHONE_CHANGE';

-- AlterTable
ALTER TABLE "otp_tokens" ADD COLUMN "targetPhone" TEXT;
