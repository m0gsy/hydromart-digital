-- Add the HR role for the HRIS Lite module (hr-service). Placed before MARKETING to
-- mirror the Prisma enum order; ordering is cosmetic (only affects enum sort).
-- Safe standalone add: the new value is not referenced in this same migration.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR' BEFORE 'MARKETING';
