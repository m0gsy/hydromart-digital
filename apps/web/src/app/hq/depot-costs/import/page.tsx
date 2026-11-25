'use client';

import { Lock } from '@phosphor-icons/react';

import { CsvImport } from '@/components/csv-import';
import { RequireAuth } from '@/components/require-auth';
import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { DEPOT_COST_IMPORT_COLUMNS } from '@/lib/depot-cost-import-columns';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotCostAdmin', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return (
    <CsvImport
      title="hq.depotCosts.import.title"
      description="hq.depotCosts.import.desc"
      columns={DEPOT_COST_IMPORT_COLUMNS}
      endpoint={endpoints.depotFixedCosts.import}
      templateName="biaya-tetap-depot"
    />
  );
}

export default function ImportDepotCostsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
