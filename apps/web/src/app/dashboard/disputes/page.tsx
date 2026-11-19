'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Scales } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  Chip,
  ErrorState,
  Field,
  Input,
  Money,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { can } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useQueryParam } from '@/lib/use-query-param';
import type {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  Order,
  OrderDispute,
  Page,
} from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

const STATUS_BADGE: Record<DisputeStatus, 'warning' | 'success' | 'neutral'> = {
  OPEN: 'warning',
  RESOLVED: 'success',
  REJECTED: 'neutral',
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** OPEN dispute resolution panel: optional note + three resolution actions. */
function ResolvePanel({ dispute, onDone }: { dispute: OrderDispute; onDone: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<DisputeResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: DisputeResolution) {
    setBusy(resolution);
    setError(null);
    try {
      await api.patch(
        endpoints.disputes.resolve(dispute.id),
        { resolution, resolutionNote: note.trim() || undefined },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashA.disputes.resolveError'));
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-app pt-3">
      <Field label={t('dashA.disputes.noteLabel')} htmlFor={`note-${dispute.id}`}>
        <Input
          id={`note-${dispute.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('dashA.disputes.notePlaceholder')}
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="flex-1"
          loading={busy === 'REFUND'}
          disabled={busy != null}
          onClick={() => resolve('REFUND')}
        >
          {t('dashA.disputes.refund', { amount: formatIDR(dispute.amountIdr) })}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          loading={busy === 'RESEND'}
          disabled={busy != null}
          onClick={() => resolve('RESEND')}
        >
          {t('dashA.disputes.resend')}
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          loading={busy === 'REJECTED'}
          disabled={busy != null}
          onClick={() => resolve('REJECTED')}
        >
          {t('dashA.disputes.reject')}
        </Button>
      </div>
    </div>
  );
}

function DisputeCard({ dispute, onChanged }: { dispute: OrderDispute; onChanged: () => void }) {
  const { t } = useT();
  const open = dispute.status === 'OPEN';
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold">{dispute.orderRef}</p>
            <Chip tone="outline">{t(`dashA.disputes.category.${dispute.category}`)}</Chip>
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">
            {dispute.customerName} · {formatDateTime(dispute.createdAt)}
          </p>
        </div>
        <Badge tone={STATUS_BADGE[dispute.status]}>{t(`dashA.disputes.status.${dispute.status}`)}</Badge>
      </div>

      <p className="rounded-lg bg-[color:var(--surface-soft)] p-3 text-[12.5px] italic text-[color:var(--text-muted)]">
        “{dispute.description}”
      </p>

      <dl className="flex flex-col divide-y divide-[color:var(--border)] rounded-lg border border-app px-3">
        <Fact label={t('dashA.disputes.factAmount')}>
          <Money amount={dispute.amountIdr} />
        </Fact>
        <Fact label={t('dashA.disputes.factCourier')}>{dispute.courierName ?? '—'}</Fact>
      </dl>

      {open ? (
        <ResolvePanel dispute={dispute} onDone={onChanged} />
      ) : (
        <p className="border-t border-app pt-3 text-xs font-medium text-[color:var(--text-muted)]">
          {dispute.resolution ? `${t(`dashA.disputes.resolution.${dispute.resolution}`)} · ` : ''}
          {dispute.resolutionNote || t('dashA.disputes.resolvedFallback')}
        </p>
      )}
    </Card>
  );
}

// An order id from a link: only a UUID goes into a request path.
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collapsible "Catat sengketa" create form.
 *
 * Flow PR-7d: the order number SEARCHES this depot's orders, and a pick fills the customer's
 * and the courier's names: retyping them from another screen filed disputes under orders
 * that did not exist. Opened from the order panel (`prefillOrderId`) it starts filled. The
 * dispute is always this console's depot's, so an order from another depot is refused rather
 * than filed where this list will never show it. A search that cannot be read costs nothing:
 * the boxes still take typing.
 */
function CreateForm({
  depotId,
  prefillOrderId,
  onDone,
}: {
  depotId: string;
  prefillOrderId: string | null;
  onDone: () => void;
}) {
  const { t } = useT();
  const [orderRef, setOrderRef] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [category, setCategory] = useState<DisputeCategory>('NOT_RECEIVED');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [courierName, setCourierName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The number a pick (or the panel) chose: the search stops asking about it.
  const [picked, setPicked] = useState<string | null>(null);
  // Typed into by hand: a late prefill must not overwrite it.
  const dirty = useRef(false);

  // A pick fills what the order knows and leaves what it does not: a name already typed stays.
  const pick = useCallback((order: Order) => {
    setOrderRef(order.orderNumber);
    if (order.recipientName) setCustomerName(order.recipientName);
    if (order.driverName) setCourierName(order.driverName);
    setPicked(order.orderNumber);
  }, []);

  useEffect(() => {
    if (!prefillOrderId || !ORDER_ID.test(prefillOrderId)) return;
    api
      .get<Order>(endpoints.orders.manageGet(prefillOrderId), true)
      .then((order) => {
        if (dirty.current) return;
        if (order.depotId !== depotId) {
          setError(t('dashA.disputes.otherDepot'));
          return;
        }
        pick(order);
      })
      .catch(() => {
        /* the form stays empty and still takes typing */
      });
    // `t` changes identity with the locale only; re-reading the order for that is pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillOrderId, depotId, pick]);

  const typed = useDebounce(orderRef.trim(), 300);
  const searching = typed.length >= 3 && typed !== picked;
  const matches = useAsync<Order[]>(
    async () =>
      searching
        ? (
            await api.get<Page<Order>>(
              endpoints.orders.manage({ orderNumber: typed, depotId, limit: 5 }),
              true,
            )
          ).items
        : [],
    [typed, searching, depotId],
  );
  // Hidden while a newer search is out: the last answer is for different text.
  const suggestions =
    searching && !matches.loading && !matches.error && orderRef.trim() === typed
      ? (matches.data ?? [])
      : [];

  async function submit() {
    if (!orderRef.trim() || !customerName.trim() || !description.trim()) {
      setError(t('dashA.disputes.createRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.disputes.create,
        {
          depotId,
          orderRef: orderRef.trim(),
          customerName: customerName.trim(),
          category,
          description: description.trim(),
          amountIdr: amount ? Number(amount) : undefined,
          courierName: courierName.trim() || undefined,
        },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashA.disputes.createError'));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('dashA.disputes.createTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dashA.disputes.orderRef')} htmlFor="d-ref" hint={t('dashA.disputes.orderRefHint')}>
          <Input
            id="d-ref"
            value={orderRef}
            onChange={(e) => {
              dirty.current = true;
              setOrderRef(e.target.value);
            }}
            placeholder={t('dashA.disputes.orderRefPlaceholder')}
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <ul className="mt-1.5 flex flex-col overflow-hidden rounded-lg border border-app">
              {suggestions.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => pick(o)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[color:var(--surface-soft)]"
                  >
                    <span className="font-semibold">{o.orderNumber}</span>
                    <span className="truncate text-xs text-[color:var(--text-muted)]">
                      {o.recipientName} · {formatDateTime(o.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label={t('dashA.disputes.customerName')} htmlFor="d-cust">
          <Input
            id="d-cust"
            value={customerName}
            onChange={(e) => {
              dirty.current = true;
              setCustomerName(e.target.value);
            }}
            placeholder={t('dashA.disputes.customerNamePlaceholder')}
          />
        </Field>
        <Field label={t('dashA.disputes.categoryLabel')} htmlFor="d-cat">
          <select
            id="d-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as DisputeCategory)}
            className={inputClass}
          >
            {(['WRONG_ITEM', 'NOT_RECEIVED', 'OVERCHARGED', 'QUALITY', 'OTHER'] as DisputeCategory[]).map((c) => (
              <option key={c} value={c}>
                {t(`dashA.disputes.category.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('dashA.disputes.amountLabel')} htmlFor="d-amt">
          <Input
            id="d-amt"
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('dashA.disputes.amountPlaceholder')}
          />
        </Field>
        <Field label={t('dashA.disputes.courierLabel')} htmlFor="d-cour">
          <Input
            id="d-cour"
            value={courierName}
            onChange={(e) => {
              dirty.current = true;
              setCourierName(e.target.value);
            }}
            placeholder={t('dashA.disputes.courierPlaceholder')}
          />
        </Field>
      </div>
      <Field label={t('dashA.disputes.descriptionLabel')} htmlFor="d-desc">
        <textarea
          id="d-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder={t('dashA.disputes.descriptionPlaceholder')}
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={submit} loading={busy}>
          {t('dashA.disputes.saveDispute')}
        </Button>
      </div>
    </Card>
  );
}

type StatusFilter = 'ALL' | DisputeStatus;

function DisputesBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  // Flow PR-7d: the order panel opens this with `?order=<id>`: the form, already filled. Used
  // once — saved or closed, the link is dropped, so the next "Catat sengketa" starts empty
  // and a refresh does not reopen it.
  const fromOrder = useQueryParam('order');
  const [prefill, setPrefill] = useState<string | null>(null);
  useEffect(() => {
    if (!fromOrder) return;
    setPrefill(fromOrder);
    setCreating(true);
  }, [fromOrder]);
  const dropPrefill = () => {
    if (!prefill) return;
    setPrefill(null);
    router.replace('/dashboard/disputes');
  };

  const list = useAsync<OrderDispute[]>(
    () => (scopedId ? api.get(endpoints.disputes.list({ depotId: scopedId }), true) : Promise.resolve([])),
    [scopedId],
  );

  const all = useMemo(() => list.data ?? [], [list.data]);
  const openCount = all.filter((d) => d.status === 'OPEN').length;
  const shown = filter === 'ALL' ? all : all.filter((d) => d.status === filter);
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  const CHIPS: { key: StatusFilter; label: string; count?: number }[] = [
    { key: 'ALL', label: t('dashA.disputes.chipAll'), count: all.length },
    { key: 'OPEN', label: t('dashA.disputes.chipOpen'), count: openCount },
    { key: 'RESOLVED', label: t('dashA.disputes.chipResolved') },
    { key: 'REJECTED', label: t('dashA.disputes.chipRejected') },
  ];

  function afterMutation() {
    setCreating(false);
    dropPrefill();
    list.reload();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scales size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashA.disputes.heading')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {scopedDepot ? `${scopedDepot.name} · ` : ''}
              {t('dashA.disputes.subtitle', { n: openCount })}
            </p>
          </div>
        </div>
        <Button
          variant={creating ? 'ghost' : 'secondary'}
          onClick={() => {
            if (creating) dropPrefill();
            setCreating((v) => !v);
          }}
        >
          {creating ? t('dashA.disputes.close') : t('dashA.disputes.createTitle')}
        </Button>
      </div>

      {creating && scopedId && (
        <CreateForm depotId={scopedId} prefillOrderId={prefill} onDone={afterMutation} />
      )}

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button key={c.key} type="button" className="tap-44" onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}>
            <Chip tone={filter === c.key ? 'ink' : 'outline'}>
              {c.label}
              {c.count != null && ` · ${c.count}`}
            </Chip>
          </button>
        ))}
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashA.disputes.noDepotTitle')} icon={<Scales size={40} weight="fill" />}>
          {t('dashA.disputes.noDepotBody')}
        </CenterState>
      ) : list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : shown.length === 0 ? (
        <CenterState title={t('dashA.disputes.emptyTitle')} icon={<Scales size={40} weight="fill" />}>
          {filter === 'ALL' ? t('dashA.disputes.emptyAll') : t('dashA.disputes.emptyFilter')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((d) => (
            <DisputeCard key={d.id} dispute={d} onChanged={afterMutation} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('depotDisputes', customer?.role)) {
    return (
      <CenterState title={t('dashA.disputes.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.disputes.gateBody')}
      </CenterState>
    );
  }
  return <DisputesBody />;
}

export default function DisputesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
