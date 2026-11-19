'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Lock } from '@phosphor-icons/react';

import {
  Badge,
  Button,
  Card,
  CenterState,
  Field,
  Input,
  LinkButton,
  LoadError,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { HrDepotPicker } from '@/components/hr/depot-picker';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, type DepotAssignment, type Employee } from '@/lib/hr';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { todayWib } from '@/lib/wib';

/** Today in the business zone (WEB-13), as a date input speaks it. */
function today(): string {
  return todayWib();
}

/**
 * A depot manager asks to borrow an employee of another depot. They cannot browse that depot's
 * staff, so the person is named by employee code; HR decides on the employee card.
 */
/*
 * The route answers 403 to anybody but a depot manager, so the screen says so up front instead of
 * rendering a form that can only fail (and instead of calling the API at all).
 */
export default function DepotRequestsPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const mayRequest = can('employeeAssignRequest', customer?.role);
  // HR decides these requests, so the screen is the decider's too (owner, 2026-11-19).
  const mayDecide = can('employeeAssign', customer?.role);
  if (!mayRequest && !mayDecide) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.depotRequests.gateBody')}
      </CenterState>
    );
  }
  return (
    <>
      {mayDecide && <IncomingRequests />}
      {mayRequest && <DepotRequestsBody />}
    </>
  );
}

/** One read each; statements, so the endpoint-contract check can read them. */
function fetchIncoming(): Promise<{ rows: DepotAssignment[]; total: number }> {
  return api.get<{ rows: DepotAssignment[]; total: number }>(
    endpoints.hr.depotRequestsIncoming,
    true,
  );
}
async function namesOf(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const e = await api.get<Employee>(endpoints.hr.employee(id), true);
        out[id] = e.fullName;
      } catch {
        // a name that cannot be read stays unnamed; the row still opens the record
      }
    }),
  );
  return out;
}

/**
 * Requests waiting for HR. Each opens the employee's record, where the request is approved or
 * rejected (the depot-assignment card): this screen lists, the record decides.
 */
function IncomingRequests() {
  const { t } = useT();
  const { depots } = useDepot();
  const list = useAsync(() => fetchIncoming(), []);
  const rows = list.data?.rows ?? [];
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const names = useAsync<Record<string, string>>(() => namesOf(ids), [ids.join(',')]);
  const depotName = (id: string) => depots.find((d) => d.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="mx-auto mb-5 max-w-3xl space-y-3">
      <SectionHeader
        title={t('hrFix.depotRequests.incomingTitle')}
        subtitle={t('hrFix.depotRequests.incomingHint')}
      />
      <Card className="p-5">
        {list.loading ? (
          <Skeleton className="h-16" />
        ) : list.error ? (
          <LoadError onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t('hrFix.depotRequests.incomingNone')}</p>
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {names.data?.[r.employeeId] ?? t('hrFix.payroll.unnamedEmployee')}
                    {' → '}
                    {depotName(r.depotId)}
                  </p>
                  <p className="text-sm text-muted">
                    {fmtDate(r.startDate)}
                    {r.endDate ? ` – ${fmtDate(r.endDate)}` : ''}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <LinkButton
                  href={`/hr/employees/detail?id=${encodeURIComponent(r.employeeId)}`}
                  variant="secondary"
                >
                  {t('hrFix.depotRequests.decide')}
                </LinkButton>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DepotRequestsBody() {
  const { t } = useT();
  const { toast } = useToast();
  const { depots } = useDepot();
  const [employeeCode, setEmployeeCode] = useState('');
  const [depotId, setDepotId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const list = useAsync<{ rows: DepotAssignment[]; total: number }>(
    () => api.get<{ rows: DepotAssignment[]; total: number }>(endpoints.hr.myDepotRequests, true),
    [],
  );
  const depotName = (id: string) => depots.find((d) => d.id === id)?.name ?? id.slice(0, 8);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblems([]);
    if (!employeeCode.trim() || !depotId || !endDate) return;
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.requestDepotAssignment,
        {
          employeeCode: employeeCode.trim(),
          depotId,
          startDate,
          endDate,
          note: note.trim() || undefined,
        },
        true,
      );
      toast(t('hrFix.depotRequests.sent'));
      setEmployeeCode('');
      setNote('');
      list.reload();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('hrFix.depotRequests.failed');
      setProblems(message.split(', ').filter(Boolean));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('hrFix.depotRequests.title')}
        subtitle={t('hrFix.depotRequests.hint')}
      />

      <Card className="p-5">
        <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Field label={t('hrFix.depotRequests.code')}>
            <Input
              value={employeeCode}
              placeholder={t('hrFix.depotRequests.codeHint')}
              onChange={(e) => setEmployeeCode(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <HrDepotPicker
              value={depotId}
              onChange={setDepotId}
              label={t('hrFix.depotAssignment.toDepot')}
              includeEmpty={t('hrFix.depotAssignment.pickDepot')}
            />
          </div>
          <Field label={t('hrFix.depotAssignment.start')}>
            <Input
              type="date"
              value={startDate}
              min={today()}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label={t('hrFix.depotAssignment.end')}>
            <Input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('hrFix.depotAssignment.noteOpt')}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {problems.length > 0 && (
            <ul
              className="col-span-full list-disc space-y-1 pl-5 text-sm font-medium text-[color:var(--danger)]"
              role="alert"
            >
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="col-span-full">
            <Button type="submit" loading={saving}>
              {t('hrFix.depotRequests.submit')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t('hrFix.depotRequests.mine')}</h2>
        {list.loading ? (
          <Skeleton className="h-16" />
        ) : list.error ? (
          <LoadError onRetry={list.reload} />
        ) : (list.data?.rows ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('hrFix.depotRequests.none')}</p>
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {(list.data?.rows ?? []).map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{depotName(r.depotId)}</span>
                  <Badge
                    tone={r.status === 'CANCELLED' || r.status === 'FAILED' ? 'danger' : 'neutral'}
                  >
                    {t(`hrFix.depotAssignment.status.${r.status}`)}
                  </Badge>
                </div>
                <p className="text-sm text-muted">
                  {fmtDate(r.startDate)}
                  {r.endDate ? ` – ${fmtDate(r.endDate)}` : ''}
                  {r.note ? ` · ${r.note}` : ''}
                </p>
                {r.status === 'CANCELLED' && r.failReason && (
                  <p className="text-sm text-[color:var(--danger)]">{r.failReason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
