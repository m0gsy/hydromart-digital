'use client';

import Link from 'next/link';
import { Lock } from '@phosphor-icons/react';

import { FieldFindForm } from '@/components/prospects/field-find-form';
import { RequireAuth } from '@/components/require-auth';
import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  // POST /b2b-prospects is Work: a Work-only role (Sales Depot) adds only into its own depot, assigned to itself.
  if (!can('b2bProspectWork', customer?.role)) {
    return (
      <CenterState title={t('opsFix.prospectsField.field.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospectsField.field.gateBody')}
      </CenterState>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <Link href="/dashboard/prospects" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">
        {t('opsFix.prospectsField.field.back')}
      </Link>
      <h1 className="text-xl font-bold">{t('opsFix.prospectsField.field.title')}</h1>
      <FieldFindForm />
    </div>
  );
}

export default function NewProspectPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
