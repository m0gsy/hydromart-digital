-- Second half of the IN_APP switch, in its own migration because Postgres will not let a
-- transaction reference an enum value that the same transaction added. New campaigns
-- default to the transport they actually use; historical rows keep WHATSAPP, which is the
-- truth about how they were delivered.
ALTER TABLE "campaigns" ALTER COLUMN "channel" SET DEFAULT 'IN_APP';
