-- Reverses 20260824070000_payment_proof_url.
--
-- Dropping the column discards every proof uploaded since it shipped, and a proof is
-- evidence in a dispute about money — so this is safe for exactly the one release in which
-- nothing writes it yet, which is why the column ships alone. After the upload endpoint
-- lands, rolling past this point is a decision somebody makes on purpose.
ALTER TABLE "payments" DROP COLUMN IF EXISTS "proofUrl";
