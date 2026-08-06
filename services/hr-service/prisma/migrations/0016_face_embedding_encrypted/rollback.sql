-- Rollback 0016_face_embedding_encrypted.
--
-- Lossy, and deliberately so: the ciphertext cannot be turned back into a plaintext
-- `vector` by SQL, and the key does not belong in a migration. Every employee enrolled
-- after 0016 loses their template and must re-enroll; nobody enrolled before it is
-- affected, because their plaintext row was never touched.
ALTER TABLE "face_embeddings" DROP COLUMN "vectorEnc";
