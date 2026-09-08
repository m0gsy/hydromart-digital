'use client';

import { CsvImport, intCell, type ImportColumn } from '@/components/csv-import';
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
    key: 'itemType',
    required: true,
    example: 'GALON',
    options: ['AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK'],
  },
  // i18n-ok: sample cell value in the column guide, shown verbatim as the file must contain it.
  { key: 'label', required: true, example: 'Galon 19L' },
  { key: 'unit', required: true, example: 'unit' },
  { key: 'quantity', example: '100', parse: intCell },
  { key: 'minimumStock', example: '20', parse: intCell },
  { key: 'sellPrice', example: '', parse: intCell },
  // Either identifies the product on a PRODUK row. `sku` is the one a human can actually
  // type; productId stays for files exported from elsewhere and wins if both are filled.
  { key: 'sku', example: 'AIR-19L', text: true },
  { key: 'productId', example: '', text: true },
];

function ImportInventoryBody() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — see the note in the pelanggan import: "Semua depot" would
  // silently resolve to depots[0] and pour the whole stock file into the wrong depot.
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.importsInventory.title"
      description="hrFix.imports.desc.inventory"
      columns={COLUMNS}
      endpoint={endpoints.inventory.import(selectedId)}
      templateName="stok"
    />
  );
}

/*
 * CA-6-03: this screen had no capability gate of its own.
 *
 * The rail hid the link from roles that could not use it, and typing the URL walked
 * straight past that — onto a wizard that reads a file, parses it, shows a preview, and
 * only then 403s on submit. Hiding a link is a courtesy on top of an access rule, not the
 * rule; `inventoryWrite` is the one the server actually turns on this import.
 */
function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('inventoryWrite', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <ImportInventoryBody />;
}

export default function ImportInventoryPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
