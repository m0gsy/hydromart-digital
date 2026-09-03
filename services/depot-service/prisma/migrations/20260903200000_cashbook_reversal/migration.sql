-- RERUNNABLE: every statement is IF NOT EXISTS, so a retry after a deploy that died
-- mid-migrate is a no-op rather than a hand-resolved failure.
--
-- CA-2-22: the depot cashbook had no correction path of any kind.
--
-- `cashbook_entries` is append-only and the controller offers exactly two routes: POST to
-- record and GET to list. There is no PATCH, no DELETE, no reversal. A depot that typed
-- Rp 5.000.000 where it meant Rp 500.000 had no way to put it right, and the book stayed
-- wrong for as long as it existed — while the daily close, the depot's cash position and
-- every report above it read from that same book.
--
-- The fix is NOT edit-in-place. A ledger you can edit is a ledger nobody can audit: the
-- number changes and the fact that it changed does not survive. A REVERSING ENTRY does
-- both — the original stays exactly as posted, a second entry cancels it, and the pair
-- explains itself to whoever reads the book next.
--
-- `reversesId` is nullable and points at the entry being cancelled. Null is every row that
-- exists today and every ordinary posting from now on.
ALTER TABLE "cashbook_entries" ADD COLUMN IF NOT EXISTS "reversesId" UUID;
ALTER TABLE "cashbook_entries" ADD COLUMN IF NOT EXISTS "reversalReason" TEXT;

-- One reversal per entry. Without this, a retried request — or two operators pressing the
-- button together — posts the correction twice and leaves the book wrong in the other
-- direction, which is the same bug with a minus sign.
CREATE UNIQUE INDEX IF NOT EXISTS "cashbook_entries_reversesId_key"
  ON "cashbook_entries" ("reversesId")
  WHERE "reversesId" IS NOT NULL;
