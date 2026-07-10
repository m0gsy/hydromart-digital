-- Manual rollback for migration 0001_init (payment-service).
DROP TABLE IF EXISTS "payments";
DROP TYPE IF EXISTS "PaymentStatus";
DROP TYPE IF EXISTS "PaymentMethod";
