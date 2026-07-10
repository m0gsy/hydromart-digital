-- Rollback for 0002_birthday_promo. Additive columns, safe to drop.
ALTER TABLE "customer_profiles" DROP COLUMN "lastBirthdayRewardYear";
ALTER TABLE "customer_profiles" DROP COLUMN "birthdate";
