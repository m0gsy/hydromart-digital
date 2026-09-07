'use client';

import { CsvImport, intCell, phoneCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Toko Berkah' },
  { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
  { key: 'discountPct', required: true, example: '5', parse: intCell },
  { key: 'monthlyTargetQty', required: true, example: '100', parse: intCell },
  // J11: the SOP flat price. Optional — a network that prices its agen by percentage
  // leaves the column blank — but until now it could not be set from a sheet at all, so a
  // depot bulk-loading a hundred agen had to open a hundred forms to price them.
  { key: 'flatGallonPriceIdr', example: '17000', parse: intCell },
  { key: 'joinDate', required: true, example: '2026-01-01' },
  { key: 'note', example: '' },
];

function ImportResellersBody() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId — see the note in the pelanggan import: "Semua depot" would
  // silently resolve to depots[0] and file every reseller under the wrong depot.
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.imports.resellers"
      description={t('hrFix.imports.resellersBody')}
      columns={COLUMNS}
      endpoint={endpoints.resellers.import}
      templateName="reseller"
      body={{ depotId: selectedId }}
    />
  );
}

/*
 * CA-6-03: this screen had no capability gate of its own.
 *
 * The rail hid the link from roles that could not use it, and typing the URL walked
 * straight past that — onto a wizard that reads a file, parses it, shows a preview, and
 * only then 403s on submit. Hiding a link is a courtesy on top of an access rule, not the
 * rule; `resellerAdmin` is the one the server actually turns on this import.
 */
function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('resellerAdmin', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <ImportResellersBody />;
}

export default function ImportResellersPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
