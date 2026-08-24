-- Reverses 20260824060000_pod_seal_intact.
--
-- Dropping the column loses every seal attestation recorded since it shipped. That is
-- acceptable only while nothing reads it yet — which is true for exactly this one release,
-- and is the reason the column ships alone. Once the DTO writes it, a rollback past this
-- point has to be a decision somebody makes on purpose, not a routine step.
ALTER TABLE "proofs_of_delivery" DROP COLUMN IF EXISTS "sealIntact";
