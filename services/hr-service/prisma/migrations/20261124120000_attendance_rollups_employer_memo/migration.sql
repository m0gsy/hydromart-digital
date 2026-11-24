-- HD-6 A7: (1) attendance month rollups, written by the retention scrub before it deletes the
-- raw attendance rows; (2) the employer BPJS memo a payslip was priced with. One new empty
-- table and one nullable column: nothing existing changes. Months already scrubbed cannot be
-- backfilled, so reports answer "belum ada" for them.

-- CreateTable
CREATE TABLE IF NOT EXISTS "attendance_month_rollups" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "depotId" UUID,
    "month" TEXT NOT NULL,
    "present" INTEGER NOT NULL DEFAULT 0,
    "late" INTEGER NOT NULL DEFAULT 0,
    "absent" INTEGER NOT NULL DEFAULT 0,
    "leave" INTEGER NOT NULL DEFAULT 0,
    "holiday" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_month_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (the table is new and empty, so a plain CREATE INDEX takes no meaningful lock)
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_month_rollups_employeeId_month_depotId_key" ON "attendance_month_rollups"("employeeId", "month", "depotId");
CREATE INDEX IF NOT EXISTS "attendance_month_rollups_depotId_month_idx" ON "attendance_month_rollups"("depotId", "month");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "attendance_month_rollups" ADD CONSTRAINT "attendance_month_rollups_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payrolls" ADD COLUMN IF NOT EXISTS "employerMemo" JSONB;
