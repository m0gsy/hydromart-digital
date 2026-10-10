'use client';

import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';


const COLUMNS: ImportColumn[] = [
  { key: 'name', required: true, example: 'Air Minum' },
  { key: 'slug', required: true, example: 'air-minum', text: true },
  { key: 'sortOrder', example: '1', parse: intCell },
];

function Body() {
  return (
    <CsvImport
      title="hrFix.imports.categoriesTitle"
      description="hrFix.imports.desc.categories"
      columns={COLUMNS}
      endpoint={endpoints.products.categoriesImport}
      templateName="kategori"
    />
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('catalogWrite', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ImportCategoriesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
