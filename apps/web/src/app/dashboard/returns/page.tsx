'use client';

import { useState } from 'react';
import { Lock, Recycle, Plus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  Input,
  LoadError,
  Money,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canViewReturns, canWriteReturns } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type {
  GallonCondition,
  GallonIssueSummary,
  GallonReturn,
  GallonReturnSummary,
  Page,
} from '@/lib/types';

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Inline "record return" form. Reloads the ledger + summary on success. */
function RecordForm({ depotId, onSaved }: { depotId: string; onSaved: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [deposit, setDeposit] = useState('');
  const [condition, setCondition] = useState<GallonCondition>('GOOD');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuantity('');
    setDeposit('');
    setCondition('GOOD');
    setNote('');
    setError(null);
  }

  async function submit() {
    const qty = num(quantity);
    if (qty === null || qty <= 0) {
      setError(t('opsFix.returns.qtyError'));
      return;
    }
    const dep = deposit.trim() === '' ? 0 : num(deposit);
    if (dep === null || dep < 0) {
      setError(t('opsFix.returns.depositError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.returns.create(depotId),
        { quantity: qty, depositRefunded: dep, condition, note: note || undefined },
        true,
      );
      reset();
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.returns.saveReturnError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" className="mr-1.5" />
        {t('opsFix.returns.recordReturn')}
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('opsFix.returns.recordReturnTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('opsFix.returns.qty')} htmlFor="ret-qty">
          <Input
            id="ret-qty"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t('opsFix.returns.qtyPlaceholder')}
            autoFocus
          />
        </Field>
        <Field
          label={t('opsFix.returns.depositRefunded')}
          htmlFor="ret-dep"
          hint={t('opsFix.returns.depositHint')}
        >
          <Input
            id="ret-dep"
            inputMode="numeric"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder={t('opsFix.returns.depositPlaceholder')}
          />
        </Field>
      </div>
      <Field label={t('opsFix.returns.condition')} htmlFor="ret-cond">
        <select
          id="ret-cond"
          value={condition}
          onChange={(e) => setCondition(e.target.value as GallonCondition)}
          className="w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium"
        >
          <option value="GOOD">{t('opsFix.returns.conditionGood')}</option>
          <option value="DAMAGED">{t('opsFix.returns.conditionDamaged')}</option>
        </select>
      </Field>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('opsFix.returns.notePlaceholder')} />
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={busy}
        >
          {t('opsFix.returns.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('opsFix.returns.saveReturn')}
        </Button>
      </div>
    </Card>
  );
}

// Design KPIs (11c): computed from the issue ledger (galon keluar) minus the
// return ledger (galon kembali). Outstanding = at customers = not yet returned.
/** Inline "record gallon issued on deposit" form (galon keluar). Reloads on success. */
function IssueForm({ depotId, onSaved }: { depotId: string; onSaved: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [deposit, setDeposit] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuantity('');
    setDeposit('');
    setNote('');
    setError(null);
  }

  async function submit() {
    const qty = num(quantity);
    if (qty === null || qty <= 0) {
      setError(t('opsFix.returns.qtyError'));
      return;
    }
    const dep = deposit.trim() === '' ? 0 : num(deposit);
    if (dep === null || dep < 0) {
      setError(t('opsFix.returns.depositError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.gallonIssues.create(depotId),
        { quantity: qty, depositHeld: dep, note: note || undefined },
        true,
      );
      reset();
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.returns.saveIssueError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" className="mr-1.5" />
        {t('opsFix.returns.recordIssue')}
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('opsFix.returns.recordIssueTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('opsFix.returns.qty')} htmlFor="iss-qty">
          <Input
            id="iss-qty"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t('opsFix.returns.qtyPlaceholder')}
            autoFocus
          />
        </Field>
        <Field
          label={t('opsFix.returns.depositHeldLabel')}
          htmlFor="iss-dep"
          hint={t('opsFix.returns.depositHint')}
        >
          <Input
            id="iss-dep"
            inputMode="numeric"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder={t('opsFix.returns.depositPlaceholder')}
          />
        </Field>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('opsFix.returns.notePlaceholder')} />
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={busy}
        >
          {t('opsFix.returns.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('opsFix.returns.save')}
        </Button>
      </div>
    </Card>
  );
}

function KpiTiles({ issue, ret }: { issue: GallonIssueSummary; ret: GallonReturnSummary }) {
  const { t } = useT();
  const outstanding = Math.max(0, issue.gallons - ret.gallons);
  const depositHeld = Math.max(0, issue.depositHeld - ret.depositRefunded);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card className="p-3.5">
        <p className="text-xs text-muted">{t('opsFix.returns.atCustomers')}</p>
        <p className="mt-1 text-xl font-bold tabular-nums">{outstanding}</p>
        <p className="text-[11px] text-muted">{t('opsFix.returns.atCustomersHint')}</p>
      </Card>
      <Card className="p-3.5">
        <p className="text-xs text-muted">{t('opsFix.returns.issued')}</p>
        <p className="mt-1 text-xl font-bold tabular-nums">{issue.gallons}</p>
        <p className="text-[11px] text-muted">{t('opsFix.returns.issuedHint')}</p>
      </Card>
      <Card className="p-3.5">
        <p className="text-xs text-muted">{t('opsFix.returns.returned')}</p>
        <p className="mt-1 text-xl font-bold tabular-nums">{ret.gallons}</p>
        <p className="text-[11px] text-muted">{t('opsFix.returns.returnedDamaged', { n: ret.damaged })}</p>
      </Card>
      <Card className="p-3.5">
        <p className="text-xs text-muted">{t('opsFix.returns.depositHeld')}</p>
        <Money amount={depositHeld} className="mt-1 block text-xl font-bold" />
        <p className="text-[11px] text-muted">{t('opsFix.returns.depositHeldHint')}</p>
      </Card>
    </div>
  );
}

function ReturnRow({ r }: { r: GallonReturn }) {
  const { t } = useT();
  return (
    <Card className="flex items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <p className="font-semibold tabular-nums">
          {t('opsFix.returns.gallonsSuffix', { n: r.quantity })}
          {r.condition === 'DAMAGED' && (
            <span className="ml-2">
              <Badge tone="warning">{t('opsFix.returns.damaged')}</Badge>
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {new Date(r.createdAt).toLocaleString('id-ID')}
          {r.note ? ` · ${r.note}` : ''}
        </p>
      </div>
      <Money amount={r.depositRefunded} className="shrink-0 font-semibold" />
    </Card>
  );
}

function ReturnsBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const canWrite = canWriteReturns(customer?.role);
  const { scopedId, selected, depots, ready } = useDepot();

  const summary = useAsync<GallonReturnSummary | null>(
    () => (scopedId ? api.get(endpoints.returns.summary(scopedId), true) : Promise.resolve(null)),
    [scopedId],
  );
  const issueSummary = useAsync<GallonIssueSummary | null>(
    () => (scopedId ? api.get(endpoints.gallonIssues.summary(scopedId), true) : Promise.resolve(null)),
    [scopedId],
  );
  const list = useAsync<Page<GallonReturn> | null>(
    () => (scopedId ? api.get(endpoints.returns.list(scopedId, { limit: 50 }), true) : Promise.resolve(null)),
    [scopedId],
  );

  function reload() {
    summary.reload();
    issueSummary.reload();
    list.reload();
  }

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Recycle size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('opsFix.returns.title')}</h1>
        </div>
        {canWrite && scopedId && (
          <div className="flex flex-wrap gap-2">
            <IssueForm depotId={scopedId} onSaved={reload} />
            <RecordForm depotId={scopedId} onSaved={reload} />
          </div>
        )}
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          {t('opsFix.returns.scopeNote', {
            depot: `${scopedDepot.name} · ${scopedDepot.code}`,
          })}
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title={t('opsFix.returns.noDepots')} icon={<Recycle size={40} weight="fill" />}>
          {t('opsFix.returns.noDepotsBody')}
        </CenterState>
      ) : !scopedId ? (
        <CenterState title={t('opsFix.returns.pickDepot')} icon={<Recycle size={40} weight="fill" />}>
          {t('opsFix.returns.pickDepotBody')}
        </CenterState>
      ) : (
        <>
          {summary.loading || issueSummary.loading ? (
            <Skeleton className="h-20 w-full" />
          ) : summary.data && issueSummary.data ? (
            <KpiTiles issue={issueSummary.data} ret={summary.data} />
          ) : summary.error || issueSummary.error ? (
            // The tiles used to vanish on a failed read, which on a KPI strip reads as
            // "nothing to report" rather than as a strip that could not be filled.
            <LoadError
              onRetry={() => {
                summary.reload();
                issueSummary.reload();
              }}
            />
          ) : null}

          {list.loading ? (
            <Skeleton className="h-64 w-full" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !list.data || list.data.items.length === 0 ? (
            <CenterState title={t('opsFix.returns.empty')} icon={<Recycle size={40} weight="fill" />}>
              {t('opsFix.returns.emptyBody')}
            </CenterState>
          ) : (
            <div className="flex flex-col gap-2.5">
              {list.data.items.map((r) => (
                <ReturnRow key={r.id} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewReturns(customer?.role)) {
    return (
      <CenterState title={t('opsFix.returns.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.returns.gateBody')}
      </CenterState>
    );
  }
  return <ReturnsBody />;
}

export default function ReturnsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
