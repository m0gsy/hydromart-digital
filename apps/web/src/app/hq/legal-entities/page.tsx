'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Scales } from '@phosphor-icons/react';

import { AiMatrixPanel, AssignPanel, EntitiesPanel, type AssignRow } from '@/components/hq/legal-entities';
import { Button, ErrorState, Skeleton } from '@/components/ui';
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

/** The server's per-request ceilings (AssignDepotsDto, AssignEmployeeLegalEntityDto). */
const DEPOT_BATCH = 200;
const EMPLOYEE_BATCH = 500;

const readDirectory = () => api.get<LegalEntityDirectory>(endpoints.legalEntities.entities, true);
const readDepots = () => api.get<DepotLegalEntityHistory[]>(endpoints.legalEntities.depots, true);
const readEmployees = () => api.get<EmployeeLegalEntityHistory[]>(endpoints.hr.employeeLegalEntities, true);

/**
 * The longest one read may hold a panel. `api` stops waiting for HEADERS after 15 s but not for the
 * body, and a panel holds its buttons until its refresh settles: a body that never finishes would
 * hold them for good. Past this the read counts as failed and the copy on screen as old.
 */
const READ_DEADLINE_MS = 30_000;

function withDeadline<T>(read: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('read deadline')), ms);
    read.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** One source the page reads: the last copy it got, and whether the latest read of it failed. */
interface Part<T> {
  data: T | null;
  failed: boolean;
}

/**
 * One read the page keeps fresh on its own. A refresh resolves once its answer is on screen, so a
 * panel can hold its buttons until then; only the newest refresh may land; nothing lands after the
 * page is gone; a failed refresh keeps the copy already shown and marks it as old. `replace` puts
 * in an answer the page already has (a save that returns the new state) and retires any refresh
 * still out, which would otherwise bring the older state back.
 */
function usePart<T>(read: () => Promise<T>) {
  const [part, setPart] = useState<Part<T>>({ data: null, failed: false });
  const latest = useRef(0);
  // The last refresh started. One that a newer refresh superseded must not resolve before the copy
  // that will actually be on screen: its caller (a panel holding its buttons) waits for that one.
  const newest = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const run = (async () => {
      try {
        const data = await withDeadline(read(), READ_DEADLINE_MS);
        if (mine === latest.current) setPart({ data, failed: false });
      } catch {
        if (mine === latest.current) setPart((prev) => ({ data: prev.data, failed: true }));
      }
    })();
    newest.current = run;
    let waited: Promise<void>;
    do {
      waited = newest.current;
      await waited;
    } while (waited !== newest.current);
  }, [read]);
  const replace = useCallback((data: T) => {
    latest.current += 1;
    setPart({ data, failed: false });
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      // Unmounted: whatever is still out lands nowhere.
      latest.current += 1;
    };
  }, [refresh]);
  return { part, refresh, replace };
}

/**
 * HD-5 — the legal entities, which one each depot and employee belongs to by date, and the
 * role x legal entity matrix of the AI web. Head office (`legalEntityAdmin`) edits the first
 * three; only `legalEntityAiAccess` saves the matrix. Each list is read and refreshed on its
 * own, so a slow or failing hr-service never holds back or hides the depots.
 */
export default function HqLegalEntitiesPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const directory = usePart(readDirectory);
  const depots = usePart(readDepots);
  const employees = usePart(readEmployees);
  const refreshAll = () => {
    void directory.refresh();
    void depots.refresh();
    void employees.refresh();
  };

  const entities = directory.part.data?.entities ?? [];
  const depotCode = new Map((depots.part.data ?? []).map((d) => [d.depotId, d.code]));
  const ownershipLabel = (type: string) =>
    type === 'WARALABA' ? t('hq.depots.ownership.franchise') : t('hq.depots.ownership.central');
  const depotRows: AssignRow[] = (depots.part.data ?? []).map((d) => {
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
  const employeeRows: AssignRow[] = (employees.part.data ?? []).map((e) => {
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
  // A copy on screen whose latest refresh failed: says so for as long as it is true.
  const showingOld = [directory.part, depots.part, employees.part].some((p) => p.failed && p.data);

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

      {showingOld && (
        <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
          <span className="font-medium text-[color:var(--danger)]">{t('hq.legalEntities.reloadFailed')}</span>
          <Button variant="secondary" onClick={refreshAll}>
            {t('hq.legalEntities.reload')}
          </Button>
        </div>
      )}

      {!directory.part.data ? (
        directory.part.failed ? (
          <ErrorState message={t('hq.legalEntities.loadError')} onRetry={() => void directory.refresh()} />
        ) : (
          <Skeleton className="h-40" testId="le-loading" />
        )
      ) : (
        <>
          <EntitiesPanel entities={entities} onChanged={directory.refresh} />
          {depots.part.data ? (
            <AssignPanel
              kind="depots"
              rows={depotRows}
              entities={entities}
              idsKey="depotIds"
              batchSize={DEPOT_BATCH}
              assignUrl={endpoints.legalEntities.depots}
              pointUrl={endpoints.legalEntities.depotPoint}
              onChanged={depots.refresh}
            />
          ) : (
            depots.part.failed && (
              <ErrorState message={t('hq.legalEntities.loadErrorDepots')} onRetry={() => void depots.refresh()} />
            )
          )}
          {employees.part.data ? (
            <AssignPanel
              kind="employees"
              rows={employeeRows}
              entities={entities}
              idsKey="employeeIds"
              batchSize={EMPLOYEE_BATCH}
              assignUrl={endpoints.hr.employeeLegalEntities}
              pointUrl={endpoints.hr.employeeLegalEntityPoint}
              onChanged={employees.refresh}
            />
          ) : (
            employees.part.failed && (
              <ErrorState
                message={t('hq.legalEntities.loadErrorEmployees')}
                onRetry={() => void employees.refresh()}
              />
            )
          )}
          <AiMatrixPanel
            directory={directory.part.data}
            canEdit={can('legalEntityAiAccess', customer?.role)}
            onSaved={(next) => {
              // The save's answer at once, retiring any read still out from before it; then one more
              // read, for a change somebody committed while the save was on its way back.
              directory.replace(next);
              void directory.refresh();
            }}
          />
        </>
      )}
    </div>
  );
}
