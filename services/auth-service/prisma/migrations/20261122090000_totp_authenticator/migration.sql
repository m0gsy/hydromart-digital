-- HD-4: the authenticator app (TOTP) behind the AI-web sign-in, and its recovery codes.
-- Two new tables and one new OTP purpose (an SMS code proves the phone before an app is
-- bound); nothing existing changes.

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'TOTP_ENROLMENT';

-- CreateTable
CREATE TABLE "totp_credentials" (
    "customerId" UUID NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastStep" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "totp_credentials_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "totp_recovery_codes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "totp_recovery_codes_customerId_idx" ON "totp_recovery_codes"("customerId");

-- AddForeignKey
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_recovery_codes" ADD CONSTRAINT "totp_recovery_codes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "totp_credentials"("customerId") ON DELETE CASCADE ON UPDATE CASCADE;
