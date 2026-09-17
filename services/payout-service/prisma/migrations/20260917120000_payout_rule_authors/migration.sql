-- PYO-6: commission schemes and courier earning rules decide every future payout, and
-- recorded nobody. Additive and nullable: rows from before this column keep NULL, which
-- reads as "unknown author", never as a made-up one.
ALTER TABLE "commission_schemes" ADD COLUMN IF NOT EXISTS "createdBy" UUID;
ALTER TABLE "courier_earning_rules" ADD COLUMN IF NOT EXISTS "createdBy" UUID;
