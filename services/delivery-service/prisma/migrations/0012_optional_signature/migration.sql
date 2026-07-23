-- AlterTable: recipient signature is now optional (photo + GPS + timestamp stay mandatory)
ALTER TABLE "proofs_of_delivery" ALTER COLUMN "signatureUrl" DROP NOT NULL;
