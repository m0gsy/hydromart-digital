-- Rolls back 20261108140000_payroll_snapshot.
-- Drops the frozen inputs. A regenerated DRAFT then reads the employee's CURRENT wage,
-- jabatan and PTKP again, which is how it worked before the column existed.
ALTER TABLE "payrolls" DROP COLUMN IF EXISTS "snapshot";
