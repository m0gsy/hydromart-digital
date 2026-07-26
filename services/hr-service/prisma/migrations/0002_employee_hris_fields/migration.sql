-- Fase 1: employee HRIS fields (Atasan, Shift, NPWP, BPJS).
ALTER TABLE "employees"
  ADD COLUMN "supervisorId" UUID,
  ADD COLUMN "shiftId"      UUID,
  ADD COLUMN "npwp"         TEXT,
  ADD COLUMN "bpjsKes"      TEXT,
  ADD COLUMN "bpjsTk"       TEXT;
