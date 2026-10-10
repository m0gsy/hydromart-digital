'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Lock } from '@phosphor-icons/react';

import { Badge, Button, Card, CenterState, Field, Input, LoadError, SectionHeader, Skeleton } from '@/components/ui';
import { HrDepotPicker } from '@/components/hr/depot-picker';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, type DepotAssignment } from '@/lib/hr';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

/** The local day, `YYYY-MM-DD`, in the browser own zone - what a date input speaks. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  if (!can('employeeAssignRequest', customer?.role)) {
    return (
      <CenterState title={t('hrFix.imports.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('hrFix.depotRequests.gateBody')}
      </CenterState>
    );
  }
  return <DepotRequestsBody />;
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
      <SectionHeader title={t('hrFix.depotRequests.title')} subtitle={t('hrFix.depotRequests.hint')} />

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
            <Input type="date" value={startDate} min={today()} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={t('hrFix.depotAssignment.end')}>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('hrFix.depotAssignment.noteOpt')}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {problems.length > 0 && (
            <ul className="col-span-full list-disc space-y-1 pl-5 text-sm font-medium text-[color:var(--danger)]" role="alert">
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
                  <Badge tone={r.status === 'CANCELLED' || r.status === 'FAILED' ? 'danger' : 'neutral'}>
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
