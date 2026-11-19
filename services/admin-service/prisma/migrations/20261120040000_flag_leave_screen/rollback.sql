-- Rolls back 20261120040000_flag_leave_screen.
-- Removes the row. crm reads the flag fail-closed, so a missing row means the inbox again,
-- the same as OFF.
DELETE FROM "feature_flags" WHERE "key" = 'notifications.leave_screen';
