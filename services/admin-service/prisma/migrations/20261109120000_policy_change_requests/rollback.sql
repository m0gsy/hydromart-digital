-- Rolls back 20261109120000_policy_change_requests.
-- Drops the queue. Pending requests are lost; applied changes already took effect and stay.
DROP TABLE IF EXISTS "policy_change_requests";
