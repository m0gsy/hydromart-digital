-- Rollback 0009_employee_document.
--
-- HONEST LIMIT: this drops the rows, not the files. Every uploaded object still sits in the
-- storage bucket under hr/documents/, and after this runs there is no `fileKey` left to find
-- it by. If the rollback is being run because the documents must not exist — a PDP erasure
-- rather than a code revert — empty that prefix in the bucket BEFORE running this.
DROP TABLE IF EXISTS "employee_documents";
DROP TYPE IF EXISTS "EmployeeDocumentType";
