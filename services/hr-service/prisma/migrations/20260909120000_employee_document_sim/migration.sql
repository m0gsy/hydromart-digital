-- CA-1-47: SIM (driving licence) as its own document type.
-- RERUNNABLE: IF NOT EXISTS, so a re-applied migration is a no-op rather than a failure.
ALTER TYPE "EmployeeDocumentType" ADD VALUE IF NOT EXISTS 'SIM';
