-- DB-11: the composite unique (depotId, itemType, productId) does NOT constrain non-PRODUK
-- singleton lines because Postgres treats NULL productId as distinct, so two AIR/GALON rows
-- for the same depot could coexist. Enforce singleton-ness at the DB with a partial unique
-- index (previously app-layer only). Prisma's schema DSL can't express a WHERE-partial unique
-- index, so it lives here as raw SQL.

CREATE UNIQUE INDEX "inventory_items_depotId_itemType_singleton_key"
  ON "inventory_items" ("depotId", "itemType")
  WHERE "productId" IS NULL;
