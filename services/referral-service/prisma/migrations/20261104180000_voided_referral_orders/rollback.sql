-- Destructive: dropping this table loses the order-void markers that prevent old rewards.
-- Reconcile voided referrals and restore a compatible application version first.
DROP TABLE "voided_referral_orders";
