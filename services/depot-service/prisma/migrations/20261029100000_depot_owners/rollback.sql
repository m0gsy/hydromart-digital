-- Rollback for 20261029100000_depot_owners.
-- LOSSY: co-owners, revenue shares and ownership history are discarded. `depots.ownerId`
-- (the primary owner) is untouched, so a rolled-back depot is single-owner again. Before
-- rolling back, make sure payout/order-service no longer read `owners` from depot-service.
DROP TABLE IF EXISTS "depot_owners";
