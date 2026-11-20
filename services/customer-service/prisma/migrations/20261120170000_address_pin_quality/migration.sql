-- RERUNNABLE: address package 2 (2026-11-20). Additive and nullable: an address saved before this
-- has a pin of unknown quality (NULL), which the screens show as nothing rather than as "bad".

DO $$ BEGIN
  CREATE TYPE "PinSource" AS ENUM ('GPS', 'MANUAL', 'STAFF', 'IMPORT', 'COURIER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- How far off the fix could be, in metres, as the phone reported it (GPS pins only).
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "pinAccuracyM" INTEGER;
-- Where the pin came from: the phone, typed, a staff correction, an import, a courier's proof.
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "pinSource" "PinSource";
