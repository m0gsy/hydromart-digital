-- Runs once on first Postgres startup (docker-entrypoint-initdb.d).
-- One database per microservice bounded context; hydromart_auth is created by
-- POSTGRES_DB. Add a line here whenever a new service is introduced.
CREATE DATABASE hydromart_customer;
CREATE DATABASE hydromart_product;
CREATE DATABASE hydromart_order;
CREATE DATABASE hydromart_payment;
CREATE DATABASE hydromart_delivery;
CREATE DATABASE hydromart_depot;
CREATE DATABASE hydromart_loyalty;
CREATE DATABASE hydromart_promo;
CREATE DATABASE hydromart_referral;
CREATE DATABASE hydromart_crm;
CREATE DATABASE hydromart_recommendation;
CREATE DATABASE hydromart_forecast;
CREATE DATABASE hydromart_payout;
CREATE DATABASE hydromart_admin;
