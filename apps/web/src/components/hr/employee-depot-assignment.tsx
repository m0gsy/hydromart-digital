'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, LoadError, Skeleton } from '@/components/ui';
import { HrDepotPicker } from '@/components/hr/depot-picker';
import { api, ApiError } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, type DepotAssignment } from '@/lib/hr';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

const TONE = {
  REQUESTED: 'neutral',
  PLANNED: 'brand',
  ACTIVE: 'success',
  DONE: 'neutral',
  CANCELLED: 'neutral',
  FAILED: 'danger',
} as const;

/** The local day, `YYYY-MM-DD`, in the browser's own zone - what a date input speaks. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Lend an employee to another depot for dated days, or schedule a permanent move.
 *
 * Planning only records intent; the scheduled sweep moves the person on the day (or "Terapkan
 * sekarang" does it for a due row). The whole card disappears while the feature is switched
 * off - the routes answer 404 then, and a card that only ever shows an error is worse than none.
 */
export function EmployeeDepotAssignment({ employeeId }: { employeeId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const { depots } = useDepot();
  const [kind, setKind] = useState<'LOAN' | 'PERMANENT'>('LOAN');
  const [depotId, setDepotId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // The request being rejected, and the reason typed so far (an inline form, not a browser prompt).
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const list = useAsync<{ rows: DepotAssignment[]; total: number; hidden?: boolean }>(
    () =>
      api.get<{ rows: DepotAssignment[]; total: number }>(endpoints.hr.depotAssignments(employeeId), true).catch((e) => {
        // Switched off (404) or not allowed (403): the card simply is not there.
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          return { rows: [], total: 0, hidden: true };
        }
        throw e;
      }),
    [employeeId],
  );

  if (list.data?.hidden) return null;

  const depotName = (id: string) => depots.find((d) => d.id === id)?.name ?? id.slice(0, 8);

  async function plan(e: React.FormEvent) {
    e.preventDefault();
    setProblems([]);
    if (!depotId) return setProblems([t('hrFix.depotAssignment.pickDepot')]);
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.planDepotAssignment,
        {
          employeeId,
          kind,
          depotId,
          startDate,
          endDate: kind === 'LOAN' ? endDate : undefined,
          note: note.trim() || undefined,
        },
        true,
      );
      toast(t('hrFix.depotAssignment.planned'));
      setNote('');
      list.reload();
    } catch (err) {
      // The server lists every problem at once; show them all instead of one per attempt.
      const message = err instanceof ApiError ? err.message : t('hrFix.depotAssignment.failed');
      setProblems(message.split(', ').filter(Boolean));
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, what: 'cancel' | 'apply' | 'approve' | 'reject') {
    setBusy(id);
    try {
      if (what === 'cancel') await api.patch(endpoints.hr.cancelDepotAssignment(id), {}, true);
      else if (what === 'approve') await api.post(endpoints.hr.approveDepotRequest(id), {}, true);
      else if (what === 'reject') {
        await api.post(endpoints.hr.rejectDepotRequest(id), { reason: reason.trim() }, true);
        setRejecting(null);
        setReason('');
      } else await api.post(endpoints.hr.applyDepotAssignmentNow(id), {}, true);
      toast(
        t(
          what === 'cancel'
            ? 'hrFix.depotAssignment.cancelled'
            : what === 'approve'
              ? 'hrFix.depotAssignment.approved'
              : what === 'reject'
                ? 'hrFix.depotAssignment.rejected'
                : 'hrFix.depotAssignment.applied',
        ),
      );
      list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hrFix.depotAssignment.failed'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">{t('hrFix.depotAssignment.title')}</h2>
      <p className="text-sm text-muted">{t('hrFix.depotAssignment.hint')}</p>

      {list.loading ? (
        <Skeleton className="h-16" />
      ) : list.error ? (
        <LoadError onRetry={list.reload} />
      ) : (list.data?.rows ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('hrFix.depotAssignment.empty')}</p>
      ) : (
        <div className="divide-y divide-[color:var(--border)]">
          {(list.data?.rows ?? []).map((a) => {
            const due = a.status === 'PLANNED' && a.startDate.slice(0, 10) <= today();
            return (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{depotName(a.depotId)}</span>
                    <Badge tone={TONE[a.status]}>{t(`hrFix.depotAssignment.status.${a.status}`)}</Badge>
                    <Badge tone="neutral">{t(`hrFix.depotAssignment.kind.${a.kind}`)}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {fmtDate(a.startDate)}
                    {a.endDate ? ` – ${fmtDate(a.endDate)}` : ''}
                    {a.note ? ` · ${a.note}` : ''}
                  </p>
                  {rejecting === a.id && (
                    <form
                      className="flex w-full flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (reason.trim().length >= 3) void act(a.id, 'reject');
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <Field label={t('hrFix.depotAssignment.rejectReason')}>
                          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                        </Field>
                      </div>
                      <Button type="submit" loading={busy === a.id} disabled={reason.trim().length < 3}>
                        {t('hrFix.depotAssignment.reject')}
                      </Button>
                    </form>
                  )}
                {(a.status === 'FAILED' || a.status === 'CANCELLED') && a.failReason && (
                    <p className="text-sm text-[color:var(--danger)]" role="alert">
                      {a.failReason}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status === 'REQUESTED' && (
                    <>
                      <Button loading={busy === a.id} onClick={() => act(a.id, 'approve')}>
                        {t('hrFix.depotAssignment.approve')}
                      </Button>
                      <Button variant="secondary" onClick={() => setRejecting(rejecting === a.id ? null : a.id)}>
                        {t('hrFix.depotAssignment.reject')}
                      </Button>
                    </>
                  )}
                  {due && (
                    <Button variant="secondary" loading={busy === a.id} onClick={() => act(a.id, 'apply')}>
                      {t('hrFix.depotAssignment.applyNow')}
                    </Button>
                  )}
                  {(a.status === 'PLANNED' || (a.status === 'ACTIVE' && a.kind === 'LOAN')) && (
                    <Button variant="secondary" loading={busy === a.id} onClick={() => act(a.id, 'cancel')}>
                      {t(a.status === 'ACTIVE' ? 'hrFix.depotAssignment.cutShort' : 'hrFix.depotAssignment.cancel')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={plan} className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-[color:var(--border)] pt-4 sm:grid-cols-2">
        <Field label={t('hrFix.depotAssignment.kindLabel')}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'LOAN' | 'PERMANENT')}
            className="surface-elevated w-full rounded-lg border border-app px-3 py-2 text-sm"
          >
            <option value="LOAN">{t('hrFix.depotAssignment.kind.LOAN')}</option>
            <option value="PERMANENT">{t('hrFix.depotAssignment.kind.PERMANENT')}</option>
          </select>
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
        {kind === 'LOAN' && (
          <Field label={t('hrFix.depotAssignment.end')}>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        )}
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
            {t('hrFix.depotAssignment.plan')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
