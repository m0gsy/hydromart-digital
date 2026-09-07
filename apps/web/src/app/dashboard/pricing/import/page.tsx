'use client';

import { CsvImport, intCell, numberCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  {
    key: 'productId',
    required: true,
    example: '11111111-1111-4111-8111-111111111111',
    text: true,
  },
  // i18n-ok: sample cell values below are what the uploaded file must literally contain.
  { key: 'productName', required: true, example: 'Galon 19L' },
  { key: 'currentPrice', required: true, example: '20000', parse: intCell },
  { key: 'adjustType', required: true, example: 'PERCENT', options: ['PERCENT', 'FIXED'] },
  { key: 'value', required: true, example: '-10', parse: numberCell },
  { key: 'note', example: 'Menyesuaikan harga pesaing' }, // i18n-ok: sample cell value
];

function ImportPricesBody() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — see the note in the pelanggan import: "Semua depot" would
  // silently resolve to depots[0] and propose price overrides for the wrong depot.
  if (!selectedId) {
    return (
      <CenterState
        title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')}
      />
    );
  }

  return (
    <CsvImport
      title="hrFix.importsPricing.title"
      description="Setiap baris menjadi usulan override harga dan tetap menunggu persetujuan HQ — tidak langsung berlaku."
      columns={COLUMNS}
      endpoint={endpoints.priceOverrides.import(selectedId)}
      templateName="harga-depot"
    />
  );
}

/*
 * CA-6-03: this screen had no capability gate of its own.
 *
 * The rail hid the link from roles that could not use it, and typing the URL walked
 * straight past that — onto a wizard that reads a file, parses it, shows a preview, and
 * only then 403s on submit. Hiding a link is a courtesy on top of an access rule, not the
 * rule; `depotAdmin` is the one the server actually turns on this import.
 */
function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotAdmin', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <ImportPricesBody />;
}

export default function ImportPricesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
