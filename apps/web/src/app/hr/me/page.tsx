'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';

import { Card, SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { consoleHome } from '@/lib/roles';

// Employee self-service landing (PWA). Rank-and-file staff (courier/operator/…) whose
// role has no hrView still reach this — ownership is enforced in-service by the linked
// authSubjectId (self-scoped /me endpoints) and, for check-in, the face match.
export default function MePage() {
  const { t } = useT();
  const { customer } = useAuth();
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader
        title={`Halo, ${customer?.fullName ?? 'Karyawan'}`}
        subtitle={t('hrFix.me.subtitle')}
      />
      <Link href="/hr/me/check-in">
        <Card className="p-6 text-center transition-colors hover:bg-brand-50">
          <p className="text-lg font-bold text-brand-700">{t('hrFix.me.punchNow')}</p>
          <p className="mt-1 text-sm text-muted">{t('hrFix.me.punchBody')}</p>
        </Card>
      </Link>
      <div className="grid grid-cols-2 gap-4">
        <Link href="/hr/me/attendance">
          <Card className="p-5 text-center transition-colors hover:bg-brand-50">
            <p className="font-semibold">{t('hrFix.me.myAttendance')}</p>
          </Card>
        </Link>
        <Link href="/hr/me/payroll">
          <Card className="p-5 text-center transition-colors hover:bg-brand-50">
            <p className="font-semibold">{t('hrFix.me.myPayslips')}</p>
          </Card>
        </Link>
      </div>
      <Link href="/hr/me/leave">
        <Card className="p-5 text-center transition-colors hover:bg-brand-50">
          <p className="font-semibold">{t('hrFix.me.myLeave')}</p>
          <p className="mt-1 text-sm text-muted">{t('hrFix.me.myLeaveBody')}</p>
        </Card>
      </Link>
      <Link href="/hr/me/announcements">
        <Card className="p-5 text-center transition-colors hover:bg-brand-50">
          <p className="font-semibold">{t('hrFix.me.announcements')}</p>
          <p className="mt-1 text-sm text-muted">{t('hrFix.me.announcementsBody')}</p>
        </Card>
      </Link>
      <Link href="/hr/me/enroll">
        <Card className="p-4 text-center transition-colors hover:bg-brand-50">
          <p className="text-sm font-semibold text-brand-700">{t('hrFix.me.enrollFace')}</p>
        </Card>
      </Link>
      {/* This PWA renders bare — no rail, no tabs, no shop nav. Without a way out it is a
          dead end for anyone who arrived from a console. */}
      <Link
        href={consoleHome(customer?.role)}
        className="block py-2 text-center text-sm font-semibold text-muted hover:text-brand-700"
      >
        ← Kembali ke konsol
      </Link>
    </div>
  );
}
