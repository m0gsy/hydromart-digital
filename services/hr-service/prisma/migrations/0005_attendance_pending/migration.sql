-- Offline punches: a device-timestamped punch that synced late waits for HR approval.
ALTER TYPE "AttendanceStatus" ADD VALUE 'PENDING';
