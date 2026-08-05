-- Audit DB-3: the ops-centre feed reads "these event types, newest first" with no customer
-- filter, so the existing (customerId, createdAt) index cannot serve it — that query sorted
-- the whole notifications table on every poll.
--
-- On production, build this with CREATE INDEX CONCURRENTLY *before* running the migration
-- (scripts/create-indexes.sh, audit H-39).
CREATE INDEX IF NOT EXISTS "notifications_event_createdAt_idx" ON "notifications"("event", "createdAt");
