-- Reverses 20260825140000_support_ticket_customer.
--
-- Dropping the column detaches every customer-raised complaint from the account that
-- raised it. The tickets themselves survive — staff keep the whole queue, `customerRef`
-- and `customerPhone` included — but their owners can no longer see them, and there is no
-- way to reattach them afterwards. Read the column out first if any exist.
ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "customerId";
