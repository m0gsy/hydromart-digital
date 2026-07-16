-- CreateTable
CREATE TABLE "tax_settings" (
    "id" UUID NOT NULL,
    "ppnPercent" DECIMAL(5,2) NOT NULL,
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT true,
    "invoiceFormat" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "npwp" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);
