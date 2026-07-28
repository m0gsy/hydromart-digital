-- Rollback for 0005_seed_flags_retention. Removes only the seeded rows, by the fixed ids
-- the seed assigns, so any window edited or flag flipped since keeps its current value.
DELETE FROM "feature_flags" WHERE "id" LIKE '22222222-0000-4000-a000-%';
DELETE FROM "retention_policies" WHERE "id" LIKE '11111111-0000-4000-a000-%';
