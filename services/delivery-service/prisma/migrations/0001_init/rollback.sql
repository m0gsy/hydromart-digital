-- Manual rollback for migration 0001_init (delivery-service).
DROP TABLE IF EXISTS "delivery_status_history";
DROP TABLE IF EXISTS "proofs_of_delivery";
DROP TABLE IF EXISTS "deliveries";
DROP TYPE IF EXISTS "DeliveryStatus";
