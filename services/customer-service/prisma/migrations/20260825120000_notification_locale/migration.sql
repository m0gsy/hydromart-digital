-- K5.3: the language a customer reads, stored where the sender can see it.
--
-- The choice has only ever lived in one browser's localStorage. WhatsApp and push are
-- rendered server-side by crm-service, which has no browser to ask — so a customer reading
-- the app in English still received every order update in Indonesian.
--
-- It sits on notification_preferences rather than customer_profiles because that is the row
-- that already answers "how do we message this person", and the internal endpoint crm
-- already calls returns it. Additive with a default, so it can ship with its reader.
ALTER TABLE "notification_preferences" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'id';
