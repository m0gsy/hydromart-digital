'use client';

import Link from 'next/link';

import { Card, SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

// Employee self-service landing (PWA). Rank-and-file staff (courier/operator/…) whose
// role has no hrView still reach this — ownership is enforced in-service by the linked
// authSubjectId (self-scoped /me endpoints) and, for check-in, the face match.
export default function MePage() {
  const { customer } = useAuth();
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title={`Halo, ${customer?.fullName ?? 'Karyawan'}`} subtitle="Layanan mandiri karyawan" />
      <Link href="/hr/me/check-in">
        <Card className="p-6 text-center transition-colors hover:bg-brand-50">
          <p className="text-lg font-bold text-brand-700">Absen Sekarang</p>
          <p className="mt-1 text-sm text-muted">Check-in / check-out dengan verifikasi wajah</p>
        </Card>
      </Link>
      <div className="grid grid-cols-2 gap-4">
        <Link href="/hr/me/attendance">
          <Card className="p-5 text-center transition-colors hover:bg-brand-50">
            <p className="font-semibold">Absensi Saya</p>
          </Card>
        </Link>
        <Link href="/hr/me/payroll">
          <Card className="p-5 text-center transition-colors hover:bg-brand-50">
            <p className="font-semibold">Slip Gaji Saya</p>
          </Card>
        </Link>
      </div>
      <Link href="/hr/me/enroll">
        <Card className="p-4 text-center transition-colors hover:bg-brand-50">
          <p className="text-sm font-semibold text-brand-700">Daftar / Perbarui Wajah</p>
        </Card>
      </Link>
    </div>
  );
}
