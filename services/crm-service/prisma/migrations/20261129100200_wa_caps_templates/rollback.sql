-- Rollback for 20261129100200_wa_caps_templates. NOT lossless: caps, cost counters, template state and peer state are dropped.
-- Roll the code back first, then run this.
DROP TABLE IF EXISTS "wa_peer_state";
DROP TABLE IF EXISTS "wa_templates";
DROP TABLE IF EXISTS "wa_cost_counters";
DROP TABLE IF EXISTS "wa_caps";
