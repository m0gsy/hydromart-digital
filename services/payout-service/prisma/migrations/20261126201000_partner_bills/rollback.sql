-- Reverses 20261126201000_partner_bills. THIS DROPS every bill and its lines, sent ones included.
DROP TABLE IF EXISTS "partner_bill_lines";
DROP TABLE IF EXISTS "partner_bills";
DROP TYPE IF EXISTS "PartnerBillStatus";
