'use client';

import { useCallback, useEffect, useState } from 'react';
import { Scales } from '@phosphor-icons/react';

import { AiMatrixPanel, AssignPanel, EntitiesPanel, type AssignRow } from '@/components/hq/legal-entities';
import { LoadError, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import type {
  DepotLegalEntityHistory,
  EmployeeLegalEntityHistory,
  LegalEntityDirectory,
} from '@/lib/legal-entities';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';

/** One source the page reads: its data, or that it could not be read. */
type Part<T> = { data: T | null; failed: boolean };
const pending = <T,>(): Part<T> => ({ data: null, failed: false });

/**
 * HD-5 — the legal entities, which one each depot and employee belongs to by date, and the
 * role x legal entity matrix of the AI web. Head office (`legalEntityAdmin`) edits the first
 * three; only `legalEntityAiAccess` saves the matrix. The three reads come from two services
 * and fail separately, so hr-service being down never hides the depots.
 */
export default function HqLegalEntitiesPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const [directory, setDirectory] = useState<Part<LegalEntityDirectory>>(pending);
  const [depots, setDepots] = useState<Part<DepotLegalEntityHistory[]>>(pending);
  const [employees, setEmployees] = useState<Part<EmployeeLegalEntityHistory[]>>(pending);
  // Bumped on every fresh directory, so the matrix restarts from what the server holds and
  // never saves a draft built on an older copy.
  const [rev, setRev] = useState(0);

  const load = useCallback(async () => {
    const [dir, dep, emp] = await Promise.allSettled([
      api.get<LegalEntityDirectory>(endpoints.legalEntities.entities, true),
      api.get<DepotLegalEntityHistory[]>(endpoints.legalEntities.depots, true),
      api.get<EmployeeLegalEntityHistory[]>(endpoints.hr.employeeLegalEntities, true),
    ]);
    setDirectory(dir.status === 'fulfilled' ? { data: dir.value, failed: false } : { data: null, failed: true });
    setDepots(dep.status === 'fulfilled' ? { data: dep.value, failed: false } : { data: null, failed: true });
    setEmployees(emp.status === 'fulfilled' ? { data: emp.value, failed: false } : { data: null, failed: true });
    setRev((n) => n + 1);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entities = directory.data?.entities ?? [];
  const depotRows: AssignRow[] = (depots.data ?? []).map((d) => ({
    id: d.depotId,
    title: `${d.code} · ${d.name}`,
    subtitle: d.ownershipType,
    inactive: !d.active,
    points: d.points,
  }));
  const employeeRows: AssignRow[] = (employees.data ?? []).map((e) => ({
    id: e.employeeId,
    title: e.fullName,
    subtitle: `${e.employeeCode} · ${e.position}`,
    inactive: e.status !== 'ACTIVE',
    points: e.points,
  }));
  const reload = () => void load();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <Scales size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('hq.legalEntities.title')}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t('hq.legalEntities.subtitle')}</p>
        <p className="mt-1 max-w-2xl text-sm font-medium">{t('hq.legalEntities.aiOnly')}</p>
      </div>

      {directory.failed ? (
        <LoadError onRetry={reload} />
      ) : !directory.data ? (
        <Skeleton className="h-40" testId="le-loading" />
      ) : (
        <>
          <EntitiesPanel entities={entities} onChanged={reload} />
          {depots.failed ? (
            <LoadError onRetry={reload} />
          ) : (
            depots.data && (
              <AssignPanel
                title={t('hq.legalEntities.assign.depots')}
                hint={t('hq.legalEntities.assign.depotsHint')}
                rows={depotRows}
                entities={entities}
                idsKey="depotIds"
                assignUrl={endpoints.legalEntities.depots}
                pointUrl={endpoints.legalEntities.depotPoint}
                onChanged={reload}
              />
            )
          )}
          {employees.failed ? (
            <LoadError onRetry={reload} />
          ) : (
            employees.data && (
              <AssignPanel
                title={t('hq.legalEntities.assign.employees')}
                hint={t('hq.legalEntities.assign.employeesHint')}
                rows={employeeRows}
                entities={entities}
                idsKey="employeeIds"
                assignUrl={endpoints.hr.employeeLegalEntities}
                pointUrl={endpoints.hr.employeeLegalEntityPoint}
                onChanged={reload}
              />
            )
          )}
          <AiMatrixPanel
            key={rev}
            directory={directory.data}
            canEdit={can('legalEntityAiAccess', customer?.role)}
            onSaved={(next) => {
              setDirectory({ data: next, failed: false });
              setRev((n) => n + 1);
            }}
          />
        </>
      )}
    </div>
  );
}
