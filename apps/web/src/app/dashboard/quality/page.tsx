'use client';

import { useMemo, useState } from 'react';
import { Flask, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { can } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DepotLabTest, DepotPermit, QualityHold } from '@/lib/types';
import { todayWib } from '@/lib/wib';

const REASONS = ['LAB_FAIL', 'PERMIT', 'COMPLAINT', 'OTHER'] as const;
const KINDS = ['FISIK_MIKRO', 'ECOLI', 'KIMIA', 'LENGKAP'] as const;
const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

function HoldCard({ depotId, tests, onChanged }: { depotId: string; tests: DepotLabTest[]; onChanged: () => void }) {
  const { t } = useT();
  const { customer } = useAuth();
  const role = customer?.role;
  const history = useAsync<QualityHold[]>(() => api.get(endpoints.quality.hold(depotId), true), [depotId]);
  const active = history.data?.find((h) => h.status === 'ACTIVE') ?? null;
  const [reason, setReason] = useState<(typeof REASONS)[number]>('LAB_FAIL');
  const [note, setNote] = useState('');
  const [retest, setRetest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a PASS taken on or after the day the hold began can clear it (the server checks too).
  const eligible = useMemo(
    () => (active ? tests.filter((x) => x.result === 'PASS' && x.takenOn >= todayWib(new Date(active.startedAt))) : []),
    [active, tests],
  );

  async function act(url: string, body: object, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(url, body, true);
      setNote('');
      history.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{t('dashB.quality.holdTitle')}</p>
        {history.data && <Badge tone={active ? 'danger' : 'success'}>{active ? 'HOLD' : 'OK'}</Badge>}
      </div>
      {history.loading ? (
        <Skeleton className="h-16 w-full" />
      ) : history.error ? (
        <ErrorState message={history.error} onRetry={history.reload} />
      ) : active ? (
        <>
          <p className="text-sm">{t('dashB.quality.holdOn', { time: formatDateTime(active.startedAt) })}</p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {t('dashB.quality.reason')}: {t(`dashB.quality.${active.reasonCode}`)}
            {active.note ? ` · ${active.note}` : ''}
          </p>
          {can('depotQualityHoldEnd', role) && (
            <div className="flex flex-col gap-2">
              {eligible.length === 0 ? (
                <p className="text-xs text-[color:var(--text-muted)]">{t('dashB.quality.endNone')}</p>
              ) : (
                <Field label={t('dashB.quality.endPick')} htmlFor="q-retest">
                  <select id="q-retest" className={SELECT} value={retest} onChange={(e) => setRetest(e.target.value)}>
                    <option value="" />
                    {eligible.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.takenOn} · {t(`dashB.quality.${x.kind}`)} · {x.labName} · {x.reportNo} · {t('dashB.quality.recordedBy', { who: x.recordedByRole || '?', time: formatDateTime(x.createdAt) })}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="flex justify-end">
                <Button
                  loading={busy}
                  disabled={!retest}
                  onClick={() => act(endpoints.quality.endHold(depotId), { retestId: retest }, 'dashB.quality.endError')}
                >
                  {t('dashB.quality.end')}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-[color:var(--text-muted)]">{t('dashB.quality.holdOff')}</p>
          {can('depotQualityHoldStart', role) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('dashB.quality.reason')} htmlFor="q-reason">
                <select id="q-reason" className={SELECT} value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`dashB.quality.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('dashB.quality.note')} htmlFor="q-note">
                <Input id="q-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex justify-end sm:col-span-2">
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={() => {
                    if (window.confirm(t('dashB.quality.startConfirm'))) {
                      void act(endpoints.quality.hold(depotId), { reasonCode: reason, ...(note.trim() ? { note: note.trim() } : {}) }, 'dashB.quality.startError');
                    }
                  }}
                >
                  {t('dashB.quality.start')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

function LabTests({ depotId, tests, reload }: { depotId: string; tests: DepotLabTest[]; reload: () => void }) {
  const { t } = useT();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('FISIK_MIKRO');
  const [takenOn, setTakenOn] = useState(todayWib());
  const [resultOn, setResultOn] = useState(todayWib());
  const [result, setResult] = useState<'PASS' | 'FAIL'>('PASS');
  const [labName, setLabName] = useState('');
  const [reportNo, setReportNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.quality.labTests(depotId), { kind, takenOn, resultOn, result, labName, reportNo }, true);
      setLabName('');
      setReportNo('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.quality.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('dashB.quality.labTitle')}</p>
      {tests.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">{t('dashB.quality.labEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {tests.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2">
              <span>
                {x.takenOn} · {t(`dashB.quality.${x.kind}`)} · {x.labName} · {x.reportNo}
              </span>
              <Badge tone={x.result === 'PASS' ? 'success' : 'danger'}>{t(`dashB.quality.${x.result}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dashB.quality.kind')} htmlFor="l-kind">
          <select id="l-kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`dashB.quality.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('dashB.quality.result')} htmlFor="l-result">
          <select id="l-result" className={SELECT} value={result} onChange={(e) => setResult(e.target.value as 'PASS' | 'FAIL')}>
            <option value="PASS">{t('dashB.quality.PASS')}</option>
            <option value="FAIL">{t('dashB.quality.FAIL')}</option>
          </select>
        </Field>
        <Field label={t('dashB.quality.takenOn')} htmlFor="l-taken">
          <Input id="l-taken" type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
        </Field>
        <Field label={t('dashB.quality.resultOn')} htmlFor="l-res">
          <Input id="l-res" type="date" value={resultOn} onChange={(e) => setResultOn(e.target.value)} />
        </Field>
        <Field label={t('dashB.quality.labName')} htmlFor="l-lab">
          <Input id="l-lab" value={labName} onChange={(e) => setLabName(e.target.value)} />
        </Field>
        <Field label={t('dashB.quality.reportNo')} htmlFor="l-no">
          <Input id="l-no" value={reportNo} onChange={(e) => setReportNo(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button loading={busy} disabled={labName.trim().length < 2 || !reportNo.trim()} onClick={add}>
          {t('dashB.quality.addLab')}
        </Button>
      </div>
    </Card>
  );
}

function Permits({ depotId }: { depotId: string }) {
  const { t } = useT();
  const list = useAsync<DepotPermit[]>(() => api.get(endpoints.quality.permits(depotId), true), [depotId]);
  const [kind, setKind] = useState('SLHS');
  const [number, setNumber] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.quality.permits(depotId), { kind, number, validUntil }, true);
      setNumber('');
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.quality.saveError'));
    } finally {
      setBusy(false);
    }
  }

  const today = todayWib();
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('dashB.quality.permitTitle')}</p>
      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">{t('dashB.quality.permitEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {(list.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span>
                {p.kind} {p.number} · {t('dashB.quality.validUntil')} {p.validUntil}
              </span>
              {p.validUntil < today && <Badge tone="danger">!</Badge>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('dashB.quality.permitKind')} htmlFor="p-kind">
          <Input id="p-kind" value={kind} onChange={(e) => setKind(e.target.value)} />
        </Field>
        <Field label={t('dashB.quality.permitNumber')} htmlFor="p-no">
          <Input id="p-no" value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label={t('dashB.quality.validUntil')} htmlFor="p-until">
          <Input id="p-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button loading={busy} disabled={kind.trim().length < 2 || !number.trim() || !validUntil} onClick={add}>
          {t('dashB.quality.addPermit')}
        </Button>
      </div>
    </Card>
  );
}

function QualityBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const tests = useAsync<DepotLabTest[]>(
    () => (scopedId ? api.get(endpoints.quality.labTests(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );
  const depotName = (selected ?? depots.find((d) => d.id === scopedId))?.name ?? '';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Flask size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashB.quality.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{depotName}</p>
        </div>
      </div>
      {ready && !scopedId ? (
        <CenterState title={t('dashB.quality.noDepots')} icon={<Flask size={40} weight="fill" />}>
          {''}
        </CenterState>
      ) : tests.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : tests.error ? (
        <ErrorState message={tests.error} onRetry={tests.reload} />
      ) : (
        scopedId && (
          <>
            <HoldCard depotId={scopedId} tests={tests.data ?? []} onChanged={tests.reload} />
            <LabTests depotId={scopedId} tests={tests.data ?? []} reload={tests.reload} />
            <Permits depotId={scopedId} />
          </>
        )
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotCompliance', customer?.role)) {
    return (
      <CenterState title={t('dashB.quality.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.quality.gateBody')}
      </CenterState>
    );
  }
  return <QualityBody />;
}

export default function QualityPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
