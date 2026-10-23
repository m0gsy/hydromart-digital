-- RERUNNABLE: send ledger for shift reminders. Unread by this release; the sweep that
-- claims rows here ships one release later.
CREATE TABLE IF NOT EXISTS "shift_reminders_sent" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "workDate" DATE NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_reminders_sent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "shift_reminders_sent_employeeId_workDate_key"
  ON "shift_reminders_sent"("employeeId", "workDate");
