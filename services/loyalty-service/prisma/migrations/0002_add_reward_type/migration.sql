-- Add the REWARD ledger entry kind (flat positive system grant, e.g. referral bonus).
-- Additive, non-destructive: existing rows are unaffected.

ALTER TYPE "PointsTxnType" ADD VALUE IF NOT EXISTS 'REWARD';
