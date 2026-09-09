-- Undo of 20260909190000_incident_hq_link.
--
-- Dropping these loses two things that cannot be recomputed: the number the operator took
-- from the complainant, and which HQ ticket each complaint became. The tickets themselves
-- survive in admin-service — they just stop being reachable from the depot's own record,
-- which is exactly the state this migration exists to end. Nothing else reads either
-- column, so there is no cascade.
ALTER TABLE "incidents" DROP COLUMN IF EXISTS "hqTicketRef";
ALTER TABLE "incidents" DROP COLUMN IF EXISTS "customerPhone";
