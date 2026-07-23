'use client';

import { useState } from 'react';
import { Check, Info, Lock, Minus, Plus, ClipboardText } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { HandoverItem, HandoverItemState, ShiftHandover } from '@/lib/types';

const NEXT_STATE: Record<HandoverItemState, HandoverItemState> = {
  PENDING: 'PARTIAL',
  PARTIAL: 'DONE',
  DONE: 'PENDING',
};

// Design 14d default checklist for a new handover.
const DEFAULT_ITEMS: HandoverItem[] = [
  { title: 'Hitung kas laci', subtext: '', state: 'PENDING' },
  { title: 'Cek stok galon & segel', subtext: '', state: 'PENDING' },
  { title: 'Order tertunda dialihkan', subtext: '', state: 'PENDING' },
  { title: 'Insiden terbuka diberi tahu', subtext: '', state: 'PENDING' },
  { title: 'Setoran COD diverifikasi', subtext: '', state: 'PENDING' },
];

function StateMark({ state }: { state: HandoverItemState }) {
  if (state === 'DONE') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-on-brand">
        <Check size={14} weight="bold" />
      </span>
    );
  }
  if (state === 'PARTIAL') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-amber-500 text-white">
        <Minus size={14} weight="bold" />
      </span>
    );
  }
  return <span className="size-6 rounded-full border-2 border-app" />;
}

function ActiveHandover({ handover, onChanged }: { handover: ShiftHandover; onChanged: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doneCount = handover.items.filter((it) => it.state === 'DONE').length;
  const signed = handover.signedAt != null;

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.handover.sign(handover.id), undefined, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashA.handover.signError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <ClipboardText size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashA.handover.title')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {handover.fromShift} → {handover.toShift} · {handover.fromStaff} → {handover.toStaff}
          </p>
        </div>
      </div>

      <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
        {handover.items.map((it, i) => (
          <div key={`${it.title}-${i}`} className="flex items-center gap-3 p-4">
            <StateMark state={it.state} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${it.state === 'DONE' ? 'text-[color:var(--text-muted)]' : ''}`}>
                {it.title}
              </p>
              {it.subtext && <p className="text-[12.5px] text-[color:var(--text-muted)]">{it.subtext}</p>}
            </div>
          </div>
        ))}
      </Card>

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800">
          {t('dashA.handover.progress', { done: doneCount, total: handover.items.length })}
          {signed
            ? t('dashA.handover.signedSuffix', { date: formatDateTime(handover.signedAt as string) })
            : t('dashA.handover.unsignedSuffix')}
        </p>
      </Card>

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}

      <Button className="w-full" onClick={sign} loading={busy} disabled={signed}>
        {signed ? t('dashA.handover.signed') : t('dashA.handover.sign')}
      </Button>
    </>
  );
}

function CreateForm({ depotId, onCreated }: { depotId: string; onCreated: () => void }) {
  const { t } = useT();
  const [fromShift, setFromShift] = useState('Pagi');
  const [toShift, setToShift] = useState('Sore');
  const [fromStaff, setFromStaff] = useState('');
  const [toStaff, setToStaff] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<HandoverItem[]>(DEFAULT_ITEMS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cycle = (i: number) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, state: NEXT_STATE[it.state] } : it)));

  async function submit() {
    if (!fromStaff.trim() || !toStaff.trim()) {
      setError(t('dashA.handover.staffRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.handover.create,
        {
          depotId,
          fromShift: fromShift.trim(),
          toShift: toShift.trim(),
          fromStaff: fromStaff.trim(),
          toStaff: toStaff.trim(),
          items,
          note: note.trim() || undefined,
        },
        true,
      );
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashA.handover.createError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-bold text-[color:var(--text-muted)]">{t('dashA.handover.newTitle')}</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('dashA.handover.fromShift')} htmlFor="from-shift">
          <Input id="from-shift" value={fromShift} onChange={(e) => setFromShift(e.target.value)} />
        </Field>
        <Field label={t('dashA.handover.toShift')} htmlFor="to-shift">
          <Input id="to-shift" value={toShift} onChange={(e) => setToShift(e.target.value)} />
        </Field>
        <Field label={t('dashA.handover.fromStaff')} htmlFor="from-staff">
          <Input id="from-staff" value={fromStaff} onChange={(e) => setFromStaff(e.target.value)} />
        </Field>
        <Field label={t('dashA.handover.toStaff')} htmlFor="to-staff">
          <Input id="to-staff" value={toStaff} onChange={(e) => setToStaff(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('dashA.handover.checklist')}</p>
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0" elevated={false}>
          {items.map((it, i) => (
            <button
              key={`${it.title}-${i}`}
              type="button"
              onClick={() => cycle(i)}
              className="flex items-center gap-3 p-3 text-left"
            >
              <StateMark state={it.state} />
              <span className="flex-1 text-sm font-medium">{it.title}</span>
            </button>
          ))}
        </Card>
        <p className="text-xs text-[color:var(--text-muted)]">{t('dashA.handover.checklistHint')}</p>
      </div>

      <Field label={t('dashA.handover.noteLabel')} htmlFor="handover-note">
        <Input id="handover-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}

      <Button onClick={submit} loading={busy}>
        {t('dashA.handover.create')}
      </Button>
    </Card>
  );
}

function HandoverBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [creating, setCreating] = useState(false);

  const list = useAsync<ShiftHandover[]>(
    () => (scopedId ? api.get<ShiftHandover[]>(endpoints.handover.list(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const latest = list.data?.[0] ?? null;

  const reloadAndClose = () => {
    setCreating(false);
    list.reload();
  };

  const Header = (
    <div className="flex items-center gap-2">
      <ClipboardText size={24} weight="fill" className="text-brand-500" />
      <div>
        <h1 className="text-2xl font-bold">{t('dashA.handover.title')}</h1>
        {scopedDepot && <p className="text-sm text-[color:var(--text-muted)]">{scopedDepot.name}</p>}
      </div>
    </div>
  );

  if (ready && depots.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <CenterState title={t('dashA.handover.noDepotTitle')} icon={<ClipboardText size={40} weight="fill" />}>
          {t('dashA.handover.noDepotBody')}
        </CenterState>
      </div>
    );
  }

  if (list.loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (list.error) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {Header}
        <ErrorState message={list.error} onRetry={list.reload} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {latest ? (
        <ActiveHandover handover={latest} onChanged={list.reload} />
      ) : (
        <>
          {Header}
          {!creating && (
            <CenterState title={t('dashA.handover.emptyTitle')} icon={<ClipboardText size={40} weight="fill" />}>
              {t('dashA.handover.emptyBody')}
            </CenterState>
          )}
        </>
      )}

      {creating && scopedId ? (
        <CreateForm depotId={scopedId} onCreated={reloadAndClose} />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-app p-3.5 text-sm font-semibold text-[color:var(--text-muted)] hover:bg-brand-50"
        >
          <Plus size={16} weight="bold" />
          {t('dashA.handover.newTitle')}
        </button>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotHandover', customer?.role)) {
    return (
      <CenterState title={t('dashA.handover.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.handover.gateBody')}
      </CenterState>
    );
  }
  return <HandoverBody />;
}

export default function HandoverPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
