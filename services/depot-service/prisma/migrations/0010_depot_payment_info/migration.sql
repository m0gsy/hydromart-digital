-- Per-depot payment destination shown to a paying customer (franchise model: money goes direct
-- to each depot, manually confirmed, no gateway). Additive, nullable — existing rows stay unset.
ALTER TABLE "depots" ADD COLUMN "paymentBankName" TEXT;
ALTER TABLE "depots" ADD COLUMN "paymentBankAccountNumber" TEXT;
ALTER TABLE "depots" ADD COLUMN "paymentBankAccountHolder" TEXT;
ALTER TABLE "depots" ADD COLUMN "paymentQrisImageUrl" TEXT;
