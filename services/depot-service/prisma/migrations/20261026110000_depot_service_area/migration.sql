-- Bulk depot import: a depot may be served by drawn polygons instead of only a radius.
-- Nullable and unread by this release (expand-only): every existing depot keeps routing by
-- serviceRadiusKm until a later release both writes and reads the column.
-- AlterTable
ALTER TABLE "depots" ADD COLUMN     "serviceArea" JSONB;
