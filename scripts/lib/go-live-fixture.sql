-- Rows for scripts/go-live-report.test.sh and scripts/reset-test-data.test.sh.
--
-- Each block is a psql script for ONE service database, separated by `\connect`. The rows are
-- chosen so every verdict in go-live-report.sh has a case that fires and a case that does not:
--   DEPOT-A  HKP, fully set up                       -> no findings
--   DEPOT-B  WARALABA, nothing entered               -> no payment, no hours, no owner, no commission
--   DEMO-01  fixture                                 -> excluded from "real", listed under fixtures
-- plus enough transactional rows in every table the reset clears, and a few in tables it must
-- never touch, so the test can prove both halves.

\connect hydromart_depot
INSERT INTO depots (id, code, name, "ownershipType", address, city, province, lat, lng, "deliveryFee",
                    "minOrderAmount", "contactPhone", "paymentBankName", "paymentBankAccountNumber",
                    "paymentBankAccountHolder", "operatingHours", active, "updatedAt")
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'DEPOT-A', 'Depot A', 'HKP', 'Jl A', 'Bekasi', 'Jawa Barat', -6.2, 106.9, 5000,
   10000, '+628111', 'BCA', '1234567', 'PT Hydromart',
   '{"mon":{"open":"08:00","close":"21:00"}}', true, now()),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'DEPOT-B', 'Depot B', 'WARALABA', 'Jl B', 'Depok', 'Jawa Barat', -6.4, 106.8, 0,
   NULL, NULL, NULL, NULL, NULL, '{}', true, now()),
  ('cccccccc-0000-4000-8000-00000000000c', 'DEMO-01', 'Depot Demo', 'HKP', 'Jl C', 'Malang', 'Jawa Timur', -8.4, 112.6, 1000,
   5000, NULL, NULL, NULL, NULL, '{}', true, now());
INSERT INTO inventory_items (id, "depotId", "itemType", "productId", label, unit, quantity, reserved, "updatedAt")
VALUES
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'PRODUK',
   'dddddddd-0000-4000-8000-00000000000d', 'Air Galon 19L', 'galon', 50, 4, now());
INSERT INTO stock_reservations (id, "itemId", "orderId", quantity, "createdAt", "updatedAt")
VALUES ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
        '99999999-0000-4000-8000-000000000001', 4, now(), now());

\connect hydromart_product
INSERT INTO products (id, name, sku, unit, "basePrice", "imageUrl", active, "updatedAt")
VALUES ('dddddddd-0000-4000-8000-00000000000d', 'Air Galon 19L', 'AIR-19', 'galon', 8000, 'https://x/y.jpg', true, now());

\connect hydromart_hr
INSERT INTO employees (id, "employeeCode", "fullName", phone, position, role, "employmentStatus", "joinDate",
                       "salaryType", status, "depotId", "authSubjectId", "updatedAt")
VALUES
  ('33333333-0000-4000-8000-000000000001', 'E1', 'Kepala A', '+62811', 'Kepala', 'KEPALA_DEPOT', 'PERMANENT', '2026-01-01',
   'MONTHLY', 'ACTIVE', 'aaaaaaaa-0000-4000-8000-00000000000a', '44444444-0000-4000-8000-000000000001', now()),
  ('33333333-0000-4000-8000-000000000002', 'E2', 'Staff A', '+62812', 'Staff', 'STAFF_DEPOT', 'PERMANENT', '2026-01-01',
   'DAILY', 'ACTIVE', 'aaaaaaaa-0000-4000-8000-00000000000a', NULL, now());

\connect hydromart_auth
INSERT INTO customers (id, phone, role, status, "updatedAt")
VALUES ('44444444-0000-4000-8000-000000000001', '+62811', 'SUPER_ADMIN', 'ACTIVE', now());

\connect hydromart_loyalty
INSERT INTO service_settings (id, scope, key, value, updated_by)
VALUES ('55555555-0000-4000-8000-000000000001', 'GLOBAL', 'goldDiscountPct', '0', 'fixture');

\connect hydromart_order
INSERT INTO orders (id, "orderNumber", "customerId", subtotal, "deliveryFee", discount, total, "recipientName", phone,
                    "addressLine", city, "createdAt", "updatedAt")
VALUES ('99999999-0000-4000-8000-000000000001', 'ORD-1', '66666666-0000-4000-8000-000000000001', 8000, 0, 0, 8000,
        'Tester', '+62811', 'Jl X', 'Bekasi', now() - interval '3 days', now());

\connect hydromart_payment
INSERT INTO payments (id, "orderId", "customerId", method, amount, "updatedAt")
VALUES ('77777777-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001',
        '66666666-0000-4000-8000-000000000001', 'CASH', 8000, now());

\connect hydromart_loyalty
INSERT INTO loyalty_accounts (id, "customerId", "updatedAt")
VALUES ('88888888-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000001', now());
