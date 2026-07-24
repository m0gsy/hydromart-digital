'use client';

import Link from 'next/link';

import { Card, SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

// Employee self-service landing (PWA). Rank-and-file staff (courier/operator/…) whose
// role has no hrView still reach this — ownership is enforced in-service by the face match
// + authSubjectId. ponytail: My-Attendance / My-Payroll need self-scoped read endpoints
// the backend doesn't expose yet (attendance/payroll list are hrView-only) — omitted so
// we don't ship a page that 403s. Add them when those endpoints land.
export default function MePage() {
  const { customer } = useAuth();
  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader title={`Halo, ${customer?.fullName ?? 'Karyawan'}`} subtitle="Absensi wajah" />
      <Link href="/hr/me/check-in">
        <Card className="p-6 text-center transition-colors hover:bg-brand-50">
          <p className="text-lg font-bold text-brand-700">Absen Sekarang</p>
          <p className="mt-1 text-sm text-muted">Check-in / check-out dengan verifikasi wajah</p>
        </Card>
      </Link>
    </div>
  );
}
