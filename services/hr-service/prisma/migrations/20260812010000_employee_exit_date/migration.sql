-- D3 — the date an employee actually left.
--
-- `contractEndDate` already exists but answers a different question: when a fixed-term
-- contract is DUE to end. It is explicitly documented as "a reminder for HR, not a status
-- change", it is null for every open-ended employee, and it says nothing about someone who
-- resigned in the middle of a month. Payroll needs the day they stopped being owed a wage.
--
-- Nullable, no backfill, no default: an employee who has not left has no exit date, and
-- guessing one from `status = 'RESIGNED'` would invent a day nobody recorded — and that day
-- is a number on a payslip.
ALTER TABLE "employees" ADD COLUMN "exitDate" DATE;

-- Payroll asks "who was employed during this window", which is a range scan over the two
-- boundary columns. Partial, because the overwhelming majority of rows are NULL and an
-- index over them earns nothing.
CREATE INDEX "employees_exitDate_idx" ON "employees" ("exitDate") WHERE "exitDate" IS NOT NULL;
