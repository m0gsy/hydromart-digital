-- Undoes 20261127090000_unserved_demand. LOSSY: the recorded unserved-demand rows are dropped.
ALTER TABLE "addresses" DROP COLUMN IF EXISTS "unservedMonth";
DROP TABLE IF EXISTS "unserved_demand";
