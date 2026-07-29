-- ShiftService.checkIn guards duplicates with a read-then-write (findOpenByDriver), which two
-- concurrent requests both pass. Flushing a queued offline check-in makes that race routine, so
-- the constraint has to live where it can actually hold. Prisma cannot express a partial unique
-- index, hence raw SQL; the repository maps P2002 back to ShiftAlreadyOpenError.
CREATE UNIQUE INDEX IF NOT EXISTS "shifts_one_open_per_driver"
  ON "shifts" ("driverId")
  WHERE "status" <> 'ENDED';
