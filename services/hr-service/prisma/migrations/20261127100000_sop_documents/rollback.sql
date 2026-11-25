-- Reverses 20261127100000_sop_documents.
--
-- THIS DROPS DATA: every SOP, every version of it, the depots each version covered and every
-- "sudah dibaca" acknowledgement go. The PDFs stay in the bucket (hr/sop/) but nothing points at
-- them any more. Drops run child-first.
DROP TABLE IF EXISTS "sop_acks";
DROP TABLE IF EXISTS "sop_version_depots";
DROP TABLE IF EXISTS "sop_versions";
DROP TABLE IF EXISTS "sops";
