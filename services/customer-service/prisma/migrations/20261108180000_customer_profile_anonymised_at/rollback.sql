-- Rolls back 20261108180000_customer_profile_anonymised_at.
-- Drops the marker. Anonymised customers then fall back to the old behaviour: the opt-out row is
-- gone, so the audience queries count them as reachable again until the column is restored.
ALTER TABLE "customer_profiles" DROP COLUMN IF EXISTS "anonymisedAt";
