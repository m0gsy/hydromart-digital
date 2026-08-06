-- B-19: enrolled face templates are encrypted at rest (AES-256-GCM, iv||tag||ciphertext).
--
-- Additive on purpose. The plaintext `vector` column stays so enrolments made before this
-- release keep verifying; new enrolments write `vectorEnc` and leave `vector` empty. Once
-- every row has a `vectorEnc` (or the legacy rows have expired under the 30-day biometric
-- retention window), a follow-up migration can drop `vector`.
ALTER TABLE "face_embeddings" ADD COLUMN "vectorEnc" BYTEA;
