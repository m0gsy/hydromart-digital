'use client';

import { useMemo, useState } from 'react';
import { ArrowsClockwise, Info, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Button,
  Card,
  CenterState,
  Chip,
  ErrorState,
  Field,
  Input,
  LoadError,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { DepotCustomer, DepotSubscription, DepotSubscriptionCadence } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

// Dictionary KEYS — module scope, so t() runs at the call site.
const CADENCE_LABEL: Record<DepotSubscriptionCadence, string> = {
  DAILY: 'hrFix.depotSubscriptions.daily',
  EVERY_3_DAYS: 'hrFix.depotSubscriptions.every3Days',
  WEEKLY: 'hrFix.depotSubscriptions.weekly',
  BIWEEKLY: 'hrFix.depotSubscriptions.every2Weeks',
  MONTHLY: 'hrFix.depotSubscriptions.monthly',
};

const CADENCES = Object.keys(CADENCE_LABEL) as DepotSubscriptionCadence[];

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4 text-center">
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-[color:var(--text-muted)]">{label}</p>
    </Card>
  );
}

/** Create a standing order. POSTs then reloads the roster. */
function CreateForm({ depotId, onCreated }: { depotId: string; onCreated: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  /**
   * A registered customer, not a typed name (S2).
   *
   * The name used to be free text and `customerId` optional, so most rows ended up linked
   * to nobody — and the depot CRM card could not tell a subscriber from anyone else, which
   * is why `isSubscriber` was a hardcoded null on every one of them. The directory this
   * picks from is the same one the CRM screen lists.
   */
  const [customerId, setCustomerId] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cadence, setCadence] = useState<DepotSubscriptionCadence>('WEEKLY');
  const [nextRunAt, setNextRunAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customers = useAsync<DepotCustomer[]>(
    () => (open ? api.get(endpoints.depotCrm.list(depotId), true) : Promise.resolve([])),
    [depotId, open],
  );

  function reset() {
    setCustomerId('');
    setProductLabel('');
    setQuantity('');
    setCadence('WEEKLY');
    setNextRunAt('');
    setNote('');
    setError(null);
  }

  async function submit() {
    const qty = Number(quantity);
    const picked = (customers.data ?? []).find((c) => c.id === customerId);
    if (!picked || !productLabel.trim() || !Number.isFinite(qty) || qty < 1) {
      setError(t('hrFix.depotSubscriptions.help'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.depotSubscriptions.create,
        {
          depotId,
          customerId: picked.id,
          // Still sent: the roster reads as a list of people, and the account name at the
          // moment of signing up is what the depot agreed with.
          customerName: picked.fullName ?? t('opsFix.subs.noName'),
          productLabel: productLabel.trim(),
          quantity: qty,
          cadence,
          nextRunAt: nextRunAt || undefined,
          note: note.trim() || undefined,
        },
        true,
      );
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.subs.createError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{t('opsFix.subs.newSub')}</Button>;
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{t('opsFix.subs.newSub')}</h2>
      <div className="flex flex-wrap gap-3">
        <Field label={t('opsFix.subs.customer')} htmlFor="s-name">
          <select
            id="s-name"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            disabled={customers.loading}
            className={`${inputClass} min-w-56`}
          >
            <option value="">
              {customers.loading ? t('hrFix.depotSubscriptions.loadingCustomers') : t('hrFix.depotSubscriptions.pickCustomer')}
            </option>
            {(customers.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName ?? t('hrFix.depotSubscriptions.noName')}
                {c.phone ? ` · ${c.phone}` : ''}
              </option>
            ))}
          </select>
          {/* customerId is REQUIRED on this form now, so an unread directory is not a
              shorter list — it is a form nobody can submit, for a reason not on screen. */}
          {customers.error && <LoadError onRetry={customers.reload} />}
        </Field>
        <Field label={t('opsFix.subs.product')} htmlFor="s-prod">
          <Input id="s-prod" value={productLabel} onChange={(e) => setProductLabel(e.target.value)} placeholder={t('opsFix.subs.productPlaceholder')} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label={t('opsFix.subs.qty')} htmlFor="s-qty">
          <Input
            id="s-qty"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t('opsFix.subs.qtyPlaceholder')}
          />
        </Field>
        <Field label={t('opsFix.subs.cadence')} htmlFor="s-cad">
          <select
            id="s-cad"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as DepotSubscriptionCadence)}
            className={`${inputClass} min-w-40`}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(CADENCE_LABEL[c])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('opsFix.subs.nextRun')} htmlFor="s-next">
          <Input id="s-next" type="date" value={nextRunAt} onChange={(e) => setNextRunAt(e.target.value)} />
        </Field>
      </div>
      <Field label={t('opsFix.subs.note')} htmlFor="s-note">
        <Input id="s-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('opsFix.subs.notePlaceholder')} />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={busy}
        >
          {t('opsFix.subs.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('opsFix.subs.save')}
        </Button>
      </div>
    </Card>
  );
}

function SubRow({ sub, onChanged }: { sub: DepotSubscription; onChanged: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    try {
      const url =
        sub.status === 'ACTIVE'
          ? endpoints.depotSubscriptions.pause(sub.id)
          : endpoints.depotSubscriptions.resume(sub.id);
      await api.patch(url, undefined, true);
      onChanged();
    } catch (err) {
      // try/finally with no catch: the spinner stopped, the row did not move, and nothing
      // said why. Pausing a subscription that quietly stayed active is a delivery the
      // customer did not want and nobody chose to send.
      setError(err instanceof ApiError ? err.message : t('hrFix.depotSubscriptions.statusFailed'));
    } finally {
      setBusy(false);
    }
  }

  const sublabel = [
    CADENCE_LABEL[sub.cadence],
    sub.nextRunAt ? `berikutnya ${formatDateTime(sub.nextRunAt)}` : t('hrFix.depotSubscriptions.notScheduled'),
  ].join(' · ');

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      {error && (
        <p className="order-last w-full text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
        {sub.customerName.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {sub.customerName} · <span className="tabular-nums">{sub.quantity}</span>{' '}
          {t('opsFix.subs.gallonsSuffix')}
        </p>
        <p className="text-[12.5px] text-[color:var(--text-muted)]">{sublabel}</p>
      </div>
      {sub.status === 'ACTIVE' && <Chip tone="success">{t('opsFix.subs.autoOrder')}</Chip>}
      {sub.status === 'PAUSED' && <Chip tone="amber">{t('opsFix.subs.paused')}</Chip>}
      {sub.status === 'CANCELLED' && <Chip tone="outline">{t('opsFix.subs.cancelled')}</Chip>}
      {sub.status === 'ACTIVE' && (
        <Button variant="secondary" onClick={toggle} loading={busy}>
          {t('opsFix.subs.pause')}
        </Button>
      )}
      {sub.status === 'PAUSED' && (
        <Button variant="secondary" onClick={toggle} loading={busy}>
          {t('opsFix.subs.resume')}
        </Button>
      )}
    </Card>
  );
}

function SubscriptionsBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();

  const list = useAsync<DepotSubscription[]>(
    () =>
      scopedId
        ? api.get(endpoints.depotSubscriptions.list({ depotId: scopedId }), true)
        : Promise.resolve([]),
    [scopedId],
  );

  const subs = useMemo(() => list.data ?? [], [list.data]);
  const activeCount = subs.filter((s) => s.status === 'ACTIVE').length;
  const pausedCount = subs.filter((s) => s.status === 'PAUSED').length;
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowsClockwise size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('opsFix.subs.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}
              {t('opsFix.subs.headline', { active: activeCount, paused: pausedCount })}
            </p>
          </div>
        </div>
        {scopedId && <CreateForm depotId={scopedId} onCreated={list.reload} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('opsFix.subs.statActive')} value={activeCount} />
        <Stat label={t('opsFix.subs.statPaused')} value={pausedCount} />
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('opsFix.subs.noDepots')} icon={<ArrowsClockwise size={40} weight="fill" />}>
          {t('opsFix.subs.noDepotsBody')}
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-56 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : subs.length === 0 ? (
        <CenterState title={t('opsFix.subs.empty')} icon={<ArrowsClockwise size={40} weight="fill" />}>
          {t('opsFix.subs.emptyBody')}
        </CenterState>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-[color:var(--text-muted)]">{t('opsFix.subs.running')}</h2>
          {subs.map((s) => (
            <SubRow key={s.id} sub={s} onChanged={list.reload} />
          ))}
        </section>
      )}

      <Card className="flex items-start gap-3 bg-brand-50 p-4" elevated={false}>
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-[12.5px] text-[color:var(--text)]">
          Pesanan langganan dibuat otomatis pada pagi hari jadwal dan langsung masuk antrean
          pengiriman. Pelanggan bisa menjeda kapan saja lewat aplikasi.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotSubscriptions', customer?.role)) {
    return (
      <CenterState title={t('opsFix.subs.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.subs.gateBody')}
      </CenterState>
    );
  }
  return <SubscriptionsBody />;
}

export default function SubscriptionsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
