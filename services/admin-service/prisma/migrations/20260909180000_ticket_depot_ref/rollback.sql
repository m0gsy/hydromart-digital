-- Undo of 20260909180000_ticket_depot_ref.
--
-- Dropping this loses which depot each complaint was about. Nothing else reads the column
-- and no foreign key hangs off it, so there is no cascade — but the link itself cannot be
-- recomputed afterwards: a ticket's text does not name its depot. Rolling back means the
-- complaints filed in between go back to belonging to nobody in particular.
ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "depotRef";
