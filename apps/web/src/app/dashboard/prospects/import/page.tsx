'use client';

import Link from 'next/link';
import { Lock } from '@phosphor-icons/react';
import { useState } from 'react';

import { ProspectImport } from '@/components/prospects/prospect-import';
import { RequireAuth } from '@/components/require-auth';
import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  const [refused, setRefused] = useState(false);
  if (refused || !can('b2bProspectImport', customer?.role)) {
    return (
      <CenterState title={t('opsFix.prospectsIo.import.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospectsIo.import.gateBody')}
      </CenterState>
    );
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('opsFix.prospectsIo.import.title')}</h1>
        <Link href="/dashboard/prospects" className="text-sm font-semibold text-brand-700">
          {t('opsFix.prospectsIo.import.back')}
        </Link>
      </div>
      <ProspectImport onForbidden={() => setRefused(true)} />
    </div>
  );
}

export default function ProspectImportPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
