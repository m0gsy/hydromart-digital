-- Undo of 20261003063200_promo_application_unique.
--
-- Drops the idempotency-guard unique index. apply()'s cheap hasApplicationFor() pre-check
-- still runs after this, but a concurrent/retried call for the same order would lose the
-- unique-constraint safety net underneath it.
DROP INDEX IF EXISTS "promo_applications_orderId_promoRuleId_productId_key";
