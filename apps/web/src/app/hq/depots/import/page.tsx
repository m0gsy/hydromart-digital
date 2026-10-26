'use client';

import { Lock } from '@phosphor-icons/react';
import { useState } from 'react';

import { CsvImport } from '@/components/csv-import';
import { RequireAuth } from '@/components/require-auth';
import { CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { DEPOT_IMPORT_COLUMNS } from '@/lib/depot-import-columns';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';

function Body() {
  const { t } = useT();
  const { customer } = useAuth();
  // Changing an existing depot is `depotAdmin` everywhere else, and the server asks for it
  // here too; offering the option to a role it would refuse only produces a 403 after upload.
  const canUpdate = can('depotAdmin', customer?.role);
  const [mode, setMode] = useState<'create' | 'upsert'>('create');
  return (
    <div className="flex flex-col gap-4">
      {canUpdate && (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">{t('hrFix.depotImport.modeLabel')}</legend>
          {(['create', 'upsert'] as const).map((value) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="depot-import-mode"
                className="mt-1"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {t(
                value === 'create'
                  ? 'hrFix.depotImport.modeCreate'
                  : 'hrFix.depotImport.modeUpsert',
              )}
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-sm text-muted">{t('hrFix.depotImport.areaNote')}</p>
      <CsvImport
        title="hrFix.imports.depots"
        description="hrFix.imports.desc.depots"
        columns={DEPOT_IMPORT_COLUMNS}
        endpoint={endpoints.depots.import}
        templateName="depot"
        body={{ mode }}
      />
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotLifecycle', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.imports.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ImportDepotsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
