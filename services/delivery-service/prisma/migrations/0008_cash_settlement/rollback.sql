-- Manual rollback for 0008_cash_settlement (delivery-service).
DROP TABLE IF EXISTS "cash_settlements";
DROP TYPE IF EXISTS "SettlementStatus";
