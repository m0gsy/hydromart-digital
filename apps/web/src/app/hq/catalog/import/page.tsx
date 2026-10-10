'use client';

import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';

/** ya/tidak (or yes/no, 1/0) to a boolean; blank is false. */
function yesNoCell(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === '' || ['tidak', 'no', 'n', 'false', '0'].includes(v)) return false;
  if (['ya', 'yes', 'y', 'true', '1'].includes(v)) return true;
  throw new Error('isi ya atau tidak');
}

const COLUMNS: ImportColumn[] = [
  // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
  { key: 'sku', required: true, example: 'AIR-GALON-19L', text: true },
  // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
  { key: 'name', required: true, example: 'Air Galon 19L' },
  // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
  { key: 'unit', required: true, example: 'Galon 19L' },
  { key: 'basePrice', required: true, example: '18000', parse: intCell },
  { key: 'categorySlug', example: 'air-minum', text: true },
  { key: 'volumeMl', example: '19000', parse: intCell },
  { key: 'isGallon', example: 'ya', parse: yesNoCell },
  { key: 'description', example: '' },
];

function Body() {
  return (
    <CsvImport
      title="hrFix.imports.productsTitle"
      description="hrFix.imports.desc.products"
      columns={COLUMNS}
      endpoint={endpoints.products.import}
      templateName="produk"
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

export default function ImportProductsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
