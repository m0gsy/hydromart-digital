-- Birthday promo (FR-091): store DOB + last-rewarded year on the customer profile.
ALTER TABLE "customer_profiles" ADD COLUMN "birthdate" DATE;
ALTER TABLE "customer_profiles" ADD COLUMN "lastBirthdayRewardYear" INTEGER;
