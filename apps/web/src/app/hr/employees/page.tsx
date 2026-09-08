'use client';

import Link from 'next/link';
import { useToast } from '@/components/toast';
import { useT } from '@/lib/locale-context';
import { useRef, useState } from 'react';

import {
  Badge,
  Card,
  ErrorState,
  Input,
  LinkButton,
  ListFooter,
  LoadError,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  departmentLabel,
  type Department,
  type Employee,
  type EmployeeStatus,
  type HrPage,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useQueryState } from '@/lib/use-query-param';
import { usePagedList } from '@/lib/use-paged-list';

/*
 * CA-1-18. The header of this screen prints `data.total` — the real headcount, straight from
 * the server — directly above a list that stopped at 100 rows and said nothing. "412
 * karyawan" over 100 of them is not a small omission: it is the screen contradicting itself,
 * with the true number in the larger type.
 *
 * 100 is also the server's `@Max`, so this cannot be widened, only paged.
 */
const PAGE_SIZE = 100;

const STATUS_TONE: Record<EmployeeStatus, 'success' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  RESIGNED: 'danger',
};

/**
 * Mint the login an employee never got — rows written before "+ Tambah" created accounts,
 * and the rare write that failed between hr-service and auth-service.
 *
 * The server decides: an employee with no jabatan is refused there (there is no role to
 * create the account with), and the refusal is shown here rather than swallowed.
 */
function CreateAccount({ employee, onCreated }: { employee: Employee; onCreated: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.hr.createEmployeeAccount(employee.id), {}, true);
      /*
       * CA-1-76. Two things were missing on the ONLY path that worked.
       *
       * Nothing was said: the reload removes this button (the employee now has a login), so
       * a success looked exactly like a button that quietly disappeared. Failure had a
       * message and success had none.
       *
       * And focus fell to <body>. This button is the element being removed, so a keyboard
       * or screen-reader user was thrown to the top of the document by succeeding. Focus
       * moves to the row's own link first, which is where the employee they just acted on
       * still is.
       */
      toast(t('hrFix.employees.accountCreated', { name: employee.fullName }));
      btn.current?.closest('[data-employee-row]')?.querySelector('a')?.focus();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.employees.accountFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        ref={btn}
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="rounded-lg border border-amber-400 px-2.5 py-1 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-50 disabled:opacity-50"
      >
        {t('hrFix.employees.noAccountCreate')}
      </button>
      {error && (
        <p className="max-w-[220px] text-right text-[11px] font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function EmployeesPage() {
  const { t } = useT();
  const { customer } = useAuth();
  /*
   * CA-1-35. These were `useState`, so opening one employee and pressing Back threw the
   * filters away — on a list somebody works THROUGH, that is the whole narrowing re-done
   * after every record they open. Held in the URL they survive the trip, and the link is
   * shareable, which a colleague asking "which ones do you mean?" can use.
   */
  const [search, setSearch] = useQueryState('q');
  /*
   * CA-1-75. `search` feeds the list's dependency array directly, so every keystroke fired
   * an authenticated, paged, depot-scoped query — "Budi" was four. `useDebounce` already
   * exists for exactly this and `employee-select.tsx` beside it already uses it.
   *
   * The debounce sits on the value the LIST reads, not on the URL: the box stays instant
   * and the query string still updates as you type, so a copied URL is what is on screen.
   */
  const debouncedSearch = useDebounce(search);
  const [statusParam, setStatus] = useQueryState('status');
  const status = statusParam as EmployeeStatus | '';
  const [departmentId, setDepartmentId] = useQueryState('departmentId');

  const list = usePagedList<Employee>(
    (page) =>
      api
        .get<HrPage<Employee>>(
          endpoints.hr.employees({
            search: debouncedSearch || undefined,
            status: status || undefined,
            departmentId: departmentId || undefined,
            page,
            pageSize: PAGE_SIZE,
          }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
    [debouncedSearch, status, departmentId],
  );
  const reload = list.reload;
  // K-9: reference data — getCached, like every other department/depot read on main.
  const departments = useAsync<Department[]>(
    () => api.getCached<Department[]>(endpoints.hr.departments(), true),
    [],
  );
  const deptRows = departments.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeader
        title={t('hrFix.employees.title')}
        subtitle={list.rows.length > 0 ? `${list.total} karyawan` : undefined}
        action={
          canManageHr(customer?.role) ? (
            <div className="flex gap-2">
              <LinkButton href="/hr/employees/import" variant="secondary">
                {t('hrFix.employees.importExcel')}
              </LinkButton>
              <LinkButton href="/hr/employees/new">{t('hrFix.employees.add')}</LinkButton>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-3">
        {/* CA-1-78: a placeholder is not a name — it vanishes as soon as anything is typed,
            and a screen reader then announces an unlabelled "edit text". The selects beside
            this one already carry `aria-label`; the search box was the exception. */}
        <Input
          aria-label={t('hrFix.employees.searchHint')}
          placeholder={t('hrFix.employees.searchHint')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          aria-label={t('hrFix.employees.allStatuses')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">{t('hrFix.employees.allStatuses')}</option>
          {(Object.keys(EMPLOYEE_STATUS_LABEL) as EmployeeStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(EMPLOYEE_STATUS_LABEL[s])}
            </option>
          ))}
        </select>
        {departments.error && <LoadError onRetry={departments.reload} />}
        <select
          aria-label={t('hrFix.employees.allDepartments')}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">{t('hrFix.employees.allDepartments')}</option>
          {deptRows.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </select>
      </div>

      {list.loading && list.rows.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {list.error && <ErrorState message={list.error} onRetry={reload} />}
      {!list.loading && !list.error && list.rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">{t('hrFix.employees.empty')}</Card>
      )}
      {list.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {list.rows.map((e) => (
            // CA-1-76: the anchor `CreateAccount` hands focus back to after it removes
            // its own button.
            <div key={e.id} data-employee-row className="flex items-center justify-between gap-3 p-4">
              <Link
                href={`/hr/employees/detail?id=${e.id}`}
                className="min-w-0 flex-1 hover:opacity-80"
              >
                <p className="truncate font-semibold">{e.fullName}</p>
                <p className="truncate text-xs text-muted">
                  {e.employeeCode} · {e.position} · {t(EMPLOYMENT_STATUS_LABEL[e.employmentStatus])}{' '}
                  ·{' '}
                  {/* Without the list, departmentLabel() answers "Belum diatur" for every
                      row at once — a whole roster claiming no department. */}
                  {departments.error
                    ? t('hrFix.employees.departmentUnreadable')
                    : departmentLabel(deptRows, e.departmentId, t)}
                </p>
              </Link>
              {/* The safety net: a row with no login is somebody who cannot clock in, and
                  nothing else on this screen would say so. */}
              {!e.authSubjectId && e.status !== 'RESIGNED' && (
                <CreateAccount employee={e} onCreated={reload} />
              )}
              <Badge tone={STATUS_TONE[e.status]}>{t(EMPLOYEE_STATUS_LABEL[e.status])}</Badge>
            </div>
          ))}
        </Card>
      )}
      <ListFooter
        shown={list.rows.length}
        total={list.total}
        hasMore={list.hasMore}
        onMore={list.loadMore}
        loading={list.loading}
      />
    </div>
  );
}
