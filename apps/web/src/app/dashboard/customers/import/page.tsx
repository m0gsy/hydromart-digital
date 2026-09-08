'use client';

import { CsvImport, phoneCell, type ImportColumn } from '@/components/csv-import';
import { useT } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { RequireAuth } from '@/components/require-auth';
import { Lock } from '@phosphor-icons/react';

import { CenterState } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Siti Aminah' },
  { key: 'phone', required: true, example: '081234567890', text: true, parse: phoneCell },
  { key: 'addressLine', example: 'Jl. Melati 3 No. 7 RT 04' },
  { key: 'city', example: 'Bekasi' },
  { key: 'province', example: 'Jawa Barat' },
  { key: 'landmark', example: 'pagar hijau sebelah warung Bu Ani' },
];

function ImportCustomersBody() {
  const { t } = useT();
  const { selectedId, ready } = useDepot();

  // selectedId, NOT scopedId. An import writes into exactly one depot, and scopedId falls
  // back to depots[0] whenever the switcher says "Semua depot" — which would file every
  // row under whichever depot happened to sort first, with nothing on screen saying so.
  if (!selectedId) {
    return <CenterState title={ready ? t('hrFix.imports.pickDepot') : t('hrFix.imports.loadingDepots')} />;
  }

  return (
    <CsvImport
      title="hrFix.imports.customers"
      description="hrFix.imports.desc.customers"
      columns={COLUMNS}
      endpoint={endpoints.depotCrm.import}
      templateName="pelanggan"
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
 * rule; `depotCrmWrite` is the one the server actually turns on this import.
 */
function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotCrmWrite', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <ImportCustomersBody />;
}

export default function ImportCustomersPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
