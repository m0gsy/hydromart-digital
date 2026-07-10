-- Add the SALE ledger entry kind: deducts sold quantities from a depot's PRODUK
-- stock lines when an order completes. Additive, non-destructive.

ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'SALE';
