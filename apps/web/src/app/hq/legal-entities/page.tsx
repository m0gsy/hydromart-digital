'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Scales } from '@phosphor-icons/react';

import { AiMatrixPanel, AssignPanel, EntitiesPanel, type AssignRow } from '@/components/hq/legal-entities';
import { useToast } from '@/components/toast';
import { ErrorState, Skeleton } from '@/components/ui';
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

/** One source the page reads: the last copy it got, and whether the latest read of it failed. */
type Part<T> = { data: T | null; failed: boolean };
const pending = <T,>(): Part<T> => ({ data: null, failed: false });

/** The server's per-request ceilings (AssignDepotsDto, AssignEmployeeLegalEntityDto). */
const DEPOT_BATCH = 200;
const EMPLOYEE_BATCH = 500;

/**
 * HD-5 — the legal entities, which one each depot and employee belongs to by date, and the
 * role x legal entity matrix of the AI web. Head office (`legalEntityAdmin`) edits the first
 * three; only `legalEntityAiAccess` saves the matrix. The three reads come from two services
 * and fail separately, so hr-service being down never hides the depots, and a reload that
 * fails keeps the copy already on screen (open forms and unsaved matrix cells included).
 */
export default function HqLegalEntitiesPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { customer } = useAuth();
  const [directory, setDirectory] = useState<Part<LegalEntityDirectory>>(pending);
  const [depots, setDepots] = useState<Part<DepotLegalEntityHistory[]>>(pending);
  const [employees, setEmployees] = useState<Part<EmployeeLegalEntityHistory[]>>(pending);
  // Reloads overlap (two quick saves); only the newest one may write what the screen shows.
  const latest = useRef(0);
  // Which parts already have a copy on screen, so a failed refresh can keep it.
  const onScreen = useRef({ directory: false, depots: false, employees: false });
  // Read through a ref so `load` keeps one identity: the effect below runs it once, not per render.
  const sayReloadFailed = useRef(() => {});
  sayReloadFailed.current = () => toast(t('hq.legalEntities.reloadFailed'), 'error');

  const load = useCallback(async () => {
    const mine = ++latest.current;
    const [dir, dep, emp] = await Promise.allSettled([
      api.get<LegalEntityDirectory>(endpoints.legalEntities.entities, true),
      api.get<DepotLegalEntityHistory[]>(endpoints.legalEntities.depots, true),
      api.get<EmployeeLegalEntityHistory[]>(endpoints.hr.employeeLegalEntities, true),
    ]);
    if (mine !== latest.current) return;
    const seen = onScreen.current;
    // A refresh that fails over a copy already shown says so once, and leaves the copy.
    const keptOld =
      (dir.status === 'rejected' && seen.directory) ||
      (dep.status === 'rejected' && seen.depots) ||
      (emp.status === 'rejected' && seen.employees);
    const settle = <T,>(set: (fn: (p: Part<T>) => Part<T>) => void, r: PromiseSettledResult<T>) =>
      set((prev) => (r.status === 'fulfilled' ? { data: r.value, failed: false } : { data: prev.data, failed: true }));
    settle(setDirectory, dir);
    settle(setDepots, dep);
    settle(setEmployees, emp);
    onScreen.current = {
      directory: seen.directory || dir.status === 'fulfilled',
      depots: seen.depots || dep.status === 'fulfilled',
      employees: seen.employees || emp.status === 'fulfilled',
    };
    if (keptOld) sayReloadFailed.current();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = () => void load();
  const entities = directory.data?.entities ?? [];
  const depotCode = new Map((depots.data ?? []).map((d) => [d.depotId, d.code]));
  const ownershipLabel = (type: string) =>
    type === 'WARALABA' ? t('hq.depots.ownership.franchise') : t('hq.depots.ownership.central');
  const depotRows: AssignRow[] = (depots.data ?? []).map((d) => {
    const subtitle = ownershipLabel(d.ownershipType);
    return {
      id: d.depotId,
      title: `${d.code} · ${d.name}`,
      subtitle,
      searchText: `${d.code} ${d.name} ${subtitle} ${d.ownershipType}`.toLowerCase(),
      inactive: !d.active,
      points: d.points,
    };
  });
  const employeeRows: AssignRow[] = (employees.data ?? []).map((e) => {
    const depot = e.depotId ? depotCode.get(e.depotId) : undefined;
    const subtitle = [e.employeeCode, e.position, depot].filter(Boolean).join(' · ');
    return {
      id: e.employeeId,
      title: e.fullName,
      subtitle,
      searchText: `${e.fullName} ${subtitle}`.toLowerCase(),
      inactive: e.status !== 'ACTIVE',
      points: e.points,
    };
  });

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

      {!directory.data ? (
        directory.failed ? (
          <ErrorState message={t('hq.legalEntities.loadError')} onRetry={reload} />
        ) : (
          <Skeleton className="h-40" testId="le-loading" />
        )
      ) : (
        <>
          <EntitiesPanel entities={entities} onChanged={reload} />
          {depots.data ? (
            <AssignPanel
              kind="depots"
              rows={depotRows}
              entities={entities}
              idsKey="depotIds"
              batchSize={DEPOT_BATCH}
              assignUrl={endpoints.legalEntities.depots}
              pointUrl={endpoints.legalEntities.depotPoint}
              onChanged={reload}
            />
          ) : (
            depots.failed && <ErrorState message={t('hq.legalEntities.loadErrorDepots')} onRetry={reload} />
          )}
          {employees.data ? (
            <AssignPanel
              kind="employees"
              rows={employeeRows}
              entities={entities}
              idsKey="employeeIds"
              batchSize={EMPLOYEE_BATCH}
              assignUrl={endpoints.hr.employeeLegalEntities}
              pointUrl={endpoints.hr.employeeLegalEntityPoint}
              onChanged={reload}
            />
          ) : (
            employees.failed && (
              <ErrorState message={t('hq.legalEntities.loadErrorEmployees')} onRetry={reload} />
            )
          )}
          <AiMatrixPanel
            directory={directory.data}
            canEdit={can('legalEntityAiAccess', customer?.role)}
            onSaved={(next) => setDirectory({ data: next, failed: false })}
          />
        </>
      )}
    </div>
  );
}
