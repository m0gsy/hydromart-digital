'use client';

import { useState } from 'react';
import { ClipboardText, Lock, Package, Plus, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  LoadError,
  Money,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { computeEffective } from '@/lib/pricing';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canViewInventory, canWriteInventory } from '@/lib/roles';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { useAsync } from '@/lib/use-async';
import type {
  DepotStockMovement,
  InventoryItem,
  Page,
  Product,
  ResolvedPrice,
  StockMovement,
  StockMovementType,
  StockReservation,
} from '@/lib/types';
import { NewLineForm } from './new-line-form';

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Read-only movement ledger for one line — opname/adjust/sale/restock history (10b). */
function MovementLog({ item }: { item: InventoryItem }) {
  const { t } = useT();
  const log = useAsync<StockMovement[]>(() => api.get(endpoints.inventory.movements(item.id), true), [item.id]);

  if (log.loading) return <Skeleton className="h-24 w-full" />;
  if (log.error) return <ErrorState message={log.error} onRetry={log.reload} />;
  if (!log.data || log.data.length === 0)
    return <p className="py-2 text-sm text-muted">{t('opsFix.inv.noMovements')}</p>;

  return (
    <ul className="flex flex-col gap-1.5">
      {log.data.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <span className="font-medium">{t(`opsFix.movementType.${m.type}`)}</span>
            {m.reason && <span className="text-muted"> · {m.reason}</span>}
            <p className="text-xs text-muted">{formatDateTime(m.createdAt)}</p>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <span className={`font-semibold ${m.delta < 0 ? 'text-[color:var(--danger)]' : 'text-emerald-700'}`}>
              {m.delta > 0 ? `+${m.delta}` : m.delta}
            </span>
            <p className="text-xs text-muted">
              {m.quantityBefore} → {m.quantityAfter}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

type ActionMode = 'none' | 'adjust' | 'opname' | 'price' | 'reorder';

/**
 * Inline adjust / opname / price forms for one stock line. Reload the list on success.
 * `initialMode` lets a row/header button jump straight into a form; `receipt` reframes
 * the signed-adjust form as a positive "terima stok" entry (same adjust endpoint).
 */
function LineActions({
  item,
  onChanged,
  initialMode = 'none',
  receipt = false,
}: {
  item: InventoryItem;
  onChanged: () => void;
  initialMode?: ActionMode;
  receipt?: boolean;
}) {
  const { t } = useT();
  const isProduk = item.itemType === 'PRODUK';
  const [mode, setMode] = useState<ActionMode>(initialMode);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: ActionMode) {
    setMode(next);
    setValue(
      next === 'price' && item.sellPrice != null
        ? String(item.sellPrice)
        : next === 'reorder'
          ? String(item.minimumStock)
          : '',
    );
    setReason('');
    setError(null);
  }

  // 7c: reorder point = minimumStock (PATCH via the line-meta update endpoint).
  async function saveReorder() {
    const parsed = num(value);
    if (parsed === null || parsed < 0) {
      setError(t('opsFix.reorder.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.inventory.update(item.id), { minimumStock: parsed }, true);
      setMode('none');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.reorder.error'));
    } finally {
      setBusy(false);
    }
  }

  // sellPrice = null clears the override (back to catalog base).
  async function savePrice(clear: boolean) {
    const parsed = clear ? null : num(value);
    if (!clear && (parsed === null || parsed < 0)) {
      setError(t('opsFix.inv.priceInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.inventory.update(item.id), { sellPrice: parsed }, true);
      setMode('none');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.inv.priceError'));
    } finally {
      setBusy(false);
    }
  }

  async function submitStock() {
    const parsed = num(value);
    if (parsed === null) {
      setError(mode === 'adjust' ? t('opsFix.inv.adjustInvalid') : t('opsFix.inv.opnameInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'adjust') {
        await api.post(endpoints.inventory.adjust(item.id), { delta: parsed, reason: reason || undefined }, true);
      } else {
        await api.post(
          endpoints.inventory.opname(item.id),
          { countedQuantity: parsed, reason: reason || undefined },
          true,
        );
      }
      setMode('none');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.inv.stockError'));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'none') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => open('adjust')}>
          {t('opsFix.inv.adjust')}
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => open('opname')}>
          {t('opsFix.inv.opname')}
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => open('reorder')}>
          {t('opsFix.reorder.button')}
        </Button>
        {isProduk && (
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => open('price')}>
            {t('opsFix.inv.price')}
          </Button>
        )}
      </div>
    );
  }

  if (mode === 'reorder') {
    return (
      <div className="flex flex-col gap-2">
        <Field label={t('opsFix.reorder.label', { unit: item.unit })} htmlFor={`r-${item.id}`} hint={t('opsFix.reorder.hint')}>
          <Input
            id={`r-${item.id}`}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('opsFix.reorder.placeholder')}
            autoFocus
          />
        </Field>
        {error && (
          <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setMode('none')} disabled={busy}>
            {t('opsFix.inv.cancel')}
          </Button>
          <Button onClick={saveReorder} loading={busy}>
            {t('opsFix.reorder.save')}
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'price') {
    return (
      <div className="flex flex-col gap-2">
        <Field
          label={t('opsFix.inv.priceOverrideTitle')}
          htmlFor={`p-${item.id}`}
          hint={t('opsFix.inv.priceOverrideHint')}
        >
          <Input
            id={`p-${item.id}`}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('opsFix.inv.priceOverridePlaceholder')}
            autoFocus
          />
        </Field>
        {error && (
          <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setMode('none')} disabled={busy}>
            {t('opsFix.inv.cancel')}
          </Button>
          {item.sellPrice != null && (
            <Button variant="danger" onClick={() => savePrice(true)} loading={busy}>
              {t('opsFix.inv.priceRemove')}
            </Button>
          )}
          <Button onClick={() => savePrice(false)} loading={busy}>
            {t('opsFix.inv.priceSave')}
          </Button>
        </div>
      </div>
    );
  }

  const isReceipt = mode === 'adjust' && receipt;
  return (
    <div className="flex flex-col gap-2">
      <Field
        label={
          mode === 'opname'
            ? t('opsFix.inv.opnameLabel', { unit: item.unit })
            : isReceipt
              ? t('opsFix.inv.receiveLabel', { unit: item.unit })
              : t('opsFix.inv.adjustLabel', { unit: item.unit })
        }
        htmlFor={`v-${item.id}`}
      >
        <Input
          id={`v-${item.id}`}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            mode === 'opname'
              ? t('opsFix.inv.opnamePlaceholder', { n: item.quantity })
              : isReceipt
                ? t('opsFix.inv.receivePlaceholder')
                : t('opsFix.inv.adjustPlaceholder')
          }
          autoFocus
        />
      </Field>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('opsFix.inv.reasonPlaceholder')}
      />
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setMode('none')} disabled={busy}>
          {t('opsFix.inv.cancel')}
        </Button>
        <Button onClick={submitStock} loading={busy}>
          {mode === 'opname'
            ? t('opsFix.inv.saveOpname')
            : isReceipt
              ? t('opsFix.inv.receiveStock')
              : t('opsFix.inv.saveAdjust')}
        </Button>
      </div>
    </div>
  );
}

/** The orders behind the "dipesan" number — a bare count left an operator with 0 available
 *  on a full shelf and nowhere to look. */
function ReservationList({ item }: { item: InventoryItem }) {
  const { t } = useT();
  const holds = useAsync<StockReservation[]>(
    () => api.get(endpoints.inventory.reservations(item.id), true),
    [item.id],
  );

  if (holds.loading) return <Skeleton className="h-10 w-full" />;
  if (holds.error) return <ErrorState message={holds.error} onRetry={holds.reload} />;
  const rows = holds.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted">{t('opsFix.inv.reservedNone')}</p>;

  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{t('opsFix.inv.reservedOrder', { order: r.orderId })}</span>
          <span className="shrink-0 tabular-nums font-medium">
            {r.quantity} {item.unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Two-step delete: the API refuses a line that holds stock or ever sold, so the only
 *  thing this guards against is a slip of the mouse on an empty line. */
function DeleteLine({ item, onDeleted }: { item: InventoryItem; onDeleted: () => void }) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.inventory.remove(item.id), true);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('opsFix.inv.deleteError'));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {armed ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t('opsFix.inv.deleteConfirm')}</span>
          <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={remove} loading={busy}>
            {t('opsFix.inv.deleteLine')}
          </Button>
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setArmed(false)}>
            {t('opsFix.inv.cancel')}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="self-start text-xs font-semibold text-[color:var(--danger)] hover:underline"
        >
          {t('opsFix.inv.deleteLine')}
        </button>
      )}
      {error && (
        <p className="text-xs font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Shared grid template so header + data rows stay aligned; scrolls inside overflow-x-auto.
const ROW_COLS =
  'grid grid-cols-[minmax(150px,2.4fr)_repeat(4,minmax(52px,0.7fr))_minmax(200px,1.3fr)] items-center gap-2 px-3';

type Entry = { mode: ActionMode; receipt: boolean };

function StockRow({
  item,
  canWrite,
  expanded,
  entry,
  price,
  onOpen,
  onChanged,
}: {
  item: InventoryItem;
  canWrite: boolean;
  expanded: boolean;
  entry: Entry;
  /** Resolved sell price for a PRODUK line: the number the customer actually pays. */
  price?: { effective: number; source: string };
  onOpen: (mode: ActionMode, receipt: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  return (
    <div className={item.lowStock ? 'bg-[color:var(--danger-bg)]' : undefined}>
      <div className={`${ROW_COLS} py-2.5`}>
        <button
          type="button"
          onClick={() => onOpen('none', false)}
          className="flex min-h-11 min-w-0 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
            {item.itemType}
          </span>
          <span className="truncate text-sm font-semibold">{item.label}</span>
        </button>
        <span className="text-right text-sm tabular-nums">{item.quantity}</span>
        <span className="text-right text-sm tabular-nums text-[color:var(--text-muted)]">{item.reserved}</span>
        <span
          className={`text-right text-sm font-semibold tabular-nums ${
            item.lowStock ? 'text-[color:var(--danger)]' : ''
          }`}
        >
          {item.available}
        </span>
        <span className="text-right text-sm tabular-nums text-[color:var(--text-muted)]">
          {item.minimumStock || '—'}
        </span>
        <div className="flex justify-end gap-2">
          {canWrite ? (
            <>
              <Button className="px-3 py-1.5 text-xs" onClick={() => onOpen('adjust', true)}>
                {t('opsFix.inv.receive')}
              </Button>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onOpen('adjust', false)}>
                {t('opsFix.inv.adjust')}
              </Button>
            </>
          ) : (
            <span className="text-xs text-[color:var(--text-muted)]">{t('opsFix.inv.readOnly')}</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-app bg-[color:var(--surface-soft)] px-3 py-3">
          {item.itemType === 'PRODUK' && price && (
            <p className="text-xs text-muted">
              {t('opsFix.inv.priceLabel')}: <Money amount={price.effective} className="font-semibold" />{' '}
              <span>({price.source})</span>
            </p>
          )}
          {canWrite && (
            <LineActions
              key={`${entry.mode}-${entry.receipt}`}
              item={item}
              initialMode={entry.mode}
              receipt={entry.receipt}
              onChanged={onChanged}
            />
          )}
          {item.reserved > 0 && (
            <div className="border-t border-app pt-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                {t('opsFix.inv.reservedBy')}
              </p>
              <ReservationList item={item} />
            </div>
          )}
          <div className="border-t border-app pt-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              {t('opsFix.inv.history')}
            </p>
            <MovementLog item={item} />
          </div>
          {canWrite && <DeleteLine item={item} onDeleted={onChanged} />}
        </div>
      )}
    </div>
  );
}

type TypeFilter = 'all' | 'bahan' | 'produk';

function Chip({
  active,
  danger,
  onClick,
  children,
}: {
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = 'inline-flex items-center gap-1 min-h-11 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors';
  const tone = danger
    ? active
      ? 'bg-[color:var(--danger)] text-white'
      : 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
    : active
      ? 'bg-brand-800 text-on-brand'
      : 'bg-[color:var(--surface-soft)] text-[color:var(--text-muted)] hover:bg-brand-50';
  return (
    <button type="button" onClick={onClick} className={`${base} ${tone}`}>
      {children}
    </button>
  );
}

const MOVE_TONE: Record<StockMovementType, { bg: string; fg: string }> = {
  RECEIPT: { bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  ADJUSTMENT: { bg: 'bg-amber-50', fg: 'text-amber-700' },
  OPNAME: { bg: 'bg-indigo-50', fg: 'text-indigo-700' },
  SALE: { bg: 'bg-[color:var(--surface-soft)]', fg: 'text-[color:var(--text-muted)]' },
};

function DepotMovementLedger({ depotId }: { depotId: string }) {
  const { t } = useT();
  const [filter, setFilter] = useState<StockMovementType | 'all'>('all');
  // Pages accumulate instead of replacing: a busy depot's history used to stop dead at
  // row 100 with nothing on screen saying so.
  const [page, setPage] = useState(1);
  const ledger = useAsync<Page<DepotStockMovement>>(
    () =>
      api.get(
        endpoints.inventory.depotMovements(depotId, {
          type: filter === 'all' ? undefined : filter,
          page,
          limit: 50,
        }),
        true,
      ),
    [depotId, filter, page],
  );
  const [seen, setSeen] = useState<DepotStockMovement[]>([]);
  const fetched = ledger.data?.items ?? [];
  // Page 1 (a fresh filter) replaces; later pages append.
  const rows = page === 1 ? fetched : [...seen, ...fetched];
  const hasMore = rows.length < (ledger.data?.total ?? 0);

  function changeFilter(next: StockMovementType | 'all') {
    setSeen([]);
    setPage(1);
    setFilter(next);
  }

  function loadMore() {
    setSeen(rows);
    setPage((p) => p + 1);
  }
  const types: (StockMovementType | 'all')[] = ['all', 'RECEIPT', 'ADJUSTMENT', 'OPNAME', 'SALE'];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted">{t('opsFix.ledger.subtitle')}</p>
      <div className="flex flex-wrap gap-2">
        {types.map((ty) => (
          <Chip key={ty} active={filter === ty} onClick={() => changeFilter(ty)}>
            {ty === 'all' ? t('opsFix.ledger.all') : t(`opsFix.movementType.${ty}`)}
          </Chip>
        ))}
      </div>
      {ledger.loading && rows.length === 0 ? (
        <Skeleton className="h-48 w-full" />
      ) : ledger.error ? (
        <ErrorState message={ledger.error} onRetry={ledger.reload} />
      ) : rows.length === 0 ? (
        <CenterState title={t('opsFix.ledger.empty')} icon={<Package size={40} weight="fill" />}>
          {t('opsFix.ledger.emptyBody')}
        </CenterState>
      ) : (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          {rows.map((m) => {
            const tone = MOVE_TONE[m.type];
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase ${tone.bg} ${tone.fg}`}>
                  {t(`opsFix.movementType.${m.type}`).slice(0, 3)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{m.itemLabel}</p>
                  <p className="truncate text-xs text-muted">
                    {t(`opsFix.movementType.${m.type}`)}
                    {m.reason ? ` · ${m.reason}` : ''} · {formatDateTime(m.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <span className={`text-sm font-semibold ${m.delta < 0 ? 'text-[color:var(--danger)]' : 'text-emerald-700'}`}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                  <p className="text-xs text-muted">
                    {m.quantityBefore} → {m.quantityAfter}
                  </p>
                </div>
              </div>
            );
          })}
        </Card>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} loading={ledger.loading}>
            {t('opsFix.inv.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 5a — batch stock-count sheet. One counted input per line; only changed rows are
 *  submitted (opname per line — there is no batch opname endpoint). */
function OpnameSheet({ items, onClose, onDone }: { items: InventoryItem[]; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ label: string; message: string }[]>([]);

  const countedOf = (item: InventoryItem): number | null => {
    const v = counts[item.id];
    return v === undefined || v.trim() === '' ? null : num(v);
  };
  const changed = items.filter((i) => {
    const c = countedOf(i);
    return c !== null && c !== i.quantity;
  });

  async function submit() {
    if (changed.length === 0) {
      setError(t('opsFix.opname.noChanges'));
      return;
    }
    setBusy(true);
    setError(null);
    setFailed([]);
    // One opname call per line — there is no batch endpoint — so a run can end up
    // half-saved. Track WHICH lines failed: "3 of 10 failed" is useless to someone
    // holding a clipboard, and reporting only a count made a partial save look total.
    const saved: string[] = [];
    const failures: { label: string; message: string }[] = [];
    for (const i of changed) {
      try {
        await api.post(endpoints.inventory.opname(i.id), { countedQuantity: countedOf(i)! }, true);
        saved.push(i.id);
      } catch (err) {
        failures.push({
          label: i.label,
          message: err instanceof ApiError ? err.message : t('opsFix.opname.submitError'),
        });
      }
    }
    setBusy(false);
    if (saved.length > 0) {
      // Clear only what actually saved. A failed line keeps the counted number on screen,
      // so a retry never means walking back to the shelf.
      setCounts((prev) => {
        const next = { ...prev };
        for (const id of saved) delete next[id];
        return next;
      });
      onDone();
    }
    if (failures.length > 0) {
      setFailed(failures);
    } else {
      onClose();
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">{t('opsFix.opname.title')}</h2>
        <p className="text-sm text-muted">{t('opsFix.opname.subtitle')}</p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid grid-cols-[minmax(140px,2fr)_80px_130px_90px] gap-2 border-b border-app px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
            <span>{t('opsFix.opname.colProduct')}</span>
            <span className="text-right">{t('opsFix.opname.colSystem')}</span>
            <span className="text-right">{t('opsFix.opname.colCounted')}</span>
            <span className="text-right">{t('opsFix.opname.colVariance')}</span>
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {items.map((i) => {
              const c = countedOf(i);
              const variance = c === null ? null : c - i.quantity;
              return (
                <div key={i.id} className="grid grid-cols-[minmax(140px,2fr)_80px_130px_90px] items-center gap-2 py-2">
                  <span className="truncate text-sm font-medium">{i.label}</span>
                  <span className="text-right text-sm tabular-nums text-muted">{i.quantity}</span>
                  <Input
                    inputMode="numeric"
                    value={counts[i.id] ?? ''}
                    onChange={(e) => setCounts((prev) => ({ ...prev, [i.id]: e.target.value }))}
                    placeholder={String(i.quantity)}
                    className="text-right"
                  />
                  <span
                    className={`text-right text-sm font-semibold tabular-nums ${
                      variance == null || variance === 0 ? 'text-muted' : variance < 0 ? 'text-[color:var(--danger)]' : 'text-emerald-700'
                    }`}
                  >
                    {variance == null ? '—' : variance > 0 ? `+${variance}` : variance}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {failed.length > 0 && (
        <div className="rounded-lg bg-[color:var(--danger-bg)] px-3 py-2.5" role="alert">
          <p className="text-sm font-semibold text-[color:var(--danger)]">
            {failed.length} baris gagal disimpan — angkanya masih tersimpan di layar, coba
            lagi.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {failed.map((f) => (
              <li key={f.label} className="text-xs text-[color:var(--danger)]">
                {f.label} — {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('opsFix.opname.cancel')}
        </Button>
        <Button onClick={submit} loading={busy} disabled={changed.length === 0}>
          {t('opsFix.opname.save')}
          {changed.length > 0 ? ` · ${changed.length}` : ''}
        </Button>
      </div>
    </Card>
  );
}

function InventoryBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const canWrite = canWriteInventory(customer?.role);
  const { scopedId, selected, depots, ready } = useDepot();
  const [lowOnly, setLowOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry>({ mode: 'none', receipt: false });
  const [view, setView] = useState<'stock' | 'movements'>('stock');
  const [opnameOpen, setOpnameOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  // `undefined` = form closed; a string (possibly empty) = open, optionally pre-picked.
  const [newLine, setNewLine] = useState<string | undefined>(undefined);

  // Every line for the depot, filtered client-side below. Fetching the low-stock subset
  // from the server made "menipis · N" and the missing-product check read off a list that
  // had already been narrowed, and re-fetched on every toggle for a list of at most 100.
  const lines = useAsync<InventoryItem[]>(
    () => (scopedId ? api.get(endpoints.inventory.lines(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );

  // The catalog, to spot products this depot never opened a line for. Those still sell —
  // the sale just never touches stock — so the operator is shown exactly which ones.
  const catalog = useAsync<Product[]>(
    () =>
      // K3.5: every page, not the first hundred. See lib/fetch-all-pages.ts — a
      // truncated catalogue is a wrong screen that looks right.
      fetchAllPages<Product>(({ page, limit }) =>
        api.get(endpoints.products.browse({ page, limit })),
      ),
    [],
  );

  // The depot label — the selected depot, or the first when "All" is active.
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  const all = lines.data ?? [];
  const visible = all.filter(
    (i) =>
      (typeFilter === 'all'
        ? true
        : typeFilter === 'produk'
          ? i.itemType === 'PRODUK'
          : i.itemType !== 'PRODUK') &&
      (!lowOnly || i.lowStock),
  );
  const lowCount = all.filter((i) => i.lowStock).length;

  // Resolved prices for the PRODUK lines on screen: override, winning rule, or the catalog
  // base. The row used to say only "harga katalog", which never told anyone the number.
  const pricedIds = all.map((i) => i.productId).filter((id): id is string => id !== null);
  const resolved = useAsync<ResolvedPrice[]>(
    () =>
      scopedId && pricedIds.length
        ? api.get(endpoints.inventory.prices(scopedId, pricedIds))
        : Promise.resolve([]),
    [scopedId, pricedIds.join(',')],
  );
  const byProduct = new Map((resolved.data ?? []).map((r) => [r.productId, r]));
  const catalogById = new Map((catalog.data ?? []).map((p) => [p.id, p]));

  function priceOf(item: InventoryItem): { effective: number; source: string } | undefined {
    if (!item.productId) return undefined;
    const base = catalogById.get(item.productId)?.basePrice;
    if (base === undefined) return undefined;
    const r = byProduct.get(item.productId);
    const eff = computeEffective(base, r);
    return {
      effective: eff.effective,
      source:
        eff.override != null
          ? t('opsFix.inv.priceFromOverride')
          : eff.adjustType
            ? t('opsFix.inv.priceFromRule')
            : t('opsFix.inv.priceFromCatalog'),
    };
  }

  // Active catalog products with no line here. They are sellable and untracked: the order
  // goes through, the ledger never moves. depot-service also alerts on the sale itself.
  const tracked = new Set(all.map((i) => i.productId).filter(Boolean));
  const untracked = (catalog.data ?? []).filter((p) => !tracked.has(p.id));

  // Toggle a row's inline detail; re-clicking the same mode/receipt collapses it.
  function openRow(id: string, mode: ActionMode, receipt: boolean) {
    if (expandedId === id && entry.mode === mode && entry.receipt === receipt) {
      setExpandedId(null);
      return;
    }
    setEntry({ mode, receipt });
    setExpandedId(id);
  }

  // Stock ops are per-line — there is no depot-wide receive endpoint — so the header
  // button asks which line first. It used to act on visible[0] silently, which put
  // received stock on whichever item happened to sort to the top.
  function pickLine(id: string) {
    setPicker(false);
    openRow(id, 'adjust', true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('opsFix.inv.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWriteInventory(customer?.role) && (
            <>
              <Button variant="secondary" onClick={() => setNewLine((v) => (v === undefined ? '' : undefined))}>
                <Plus size={16} weight="bold" /> {t('opsFix.inv.addLine')}
              </Button>
              <LinkButton href="/dashboard/inventory/import" variant="secondary">
                {t('opsFix.inv.importExcel')}
              </LinkButton>
            </>
          )}
          <div className="flex overflow-hidden rounded-full border border-app text-sm font-semibold">
            {(['stock', 'movements'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`min-h-11 px-3 py-1.5 transition-colors ${
                  view === v ? 'bg-brand-600 text-on-brand' : 'surface-elevated hover:bg-brand-50'
                }`}
              >
                {v === 'stock' ? t('opsFix.view.stock') : t('opsFix.view.movements')}
              </button>
            ))}
          </div>
          {canWrite && view === 'stock' && (
            <>
              <Button
                className="bg-brand-600"
                disabled={visible.length === 0}
                onClick={() => setPicker((v) => !v)}
              >
                <Plus size={16} weight="bold" /> {t('opsFix.inv.receiveStock')}
              </Button>
              <Button variant="secondary" disabled={visible.length === 0} onClick={() => setOpnameOpen((v) => !v)}>
                <ClipboardText size={16} /> {t('opsFix.opname.open')}
              </Button>
            </>
          )}
        </div>
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          {t('opsFix.inv.scopeNote', { depot: `${scopedDepot.name} · ${scopedDepot.code}` })}
        </p>
      )}

      {canWrite && newLine !== undefined && scopedId && (
        <NewLineForm
          key={newLine}
          depotId={scopedId}
          existing={all}
          preselectProductId={newLine || undefined}
          onCancel={() => setNewLine(undefined)}
          onDone={() => {
            setNewLine(undefined);
            lines.reload();
          }}
        />
      )}

      {canWrite && untracked.length > 0 && newLine === undefined && (
        <Card className="flex flex-col gap-2 border-l-4 border-l-[color:var(--warning)] p-4">
          <p className="text-sm font-semibold">
            {t('opsFix.inv.untrackedTitle', { n: untracked.length })}
          </p>
          <p className="text-xs text-muted">{t('opsFix.inv.untrackedBody')}</p>
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {untracked.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  {p.name} <span className="text-xs text-muted">· {p.sku}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setNewLine(p.id)}
                  className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
                >
                  {t('opsFix.inv.untrackedAction')}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Two side reads, and each one goes quiet in a way that looks like an answer: an
          unread catalog hides the untracked-products card entirely, and unread prices leave
          every row saying only "harga katalog" again. */}
      {catalog.error && <LoadError onRetry={catalog.reload} />}
      {resolved.error && <LoadError onRetry={resolved.reload} />}

      <div className="flex flex-wrap gap-2">
        <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
          {t('opsFix.inv.filterAll')}
        </Chip>
        <Chip active={typeFilter === 'bahan'} onClick={() => setTypeFilter('bahan')}>
          {t('opsFix.inv.filterRaw')}
        </Chip>
        <Chip active={typeFilter === 'produk'} onClick={() => setTypeFilter('produk')}>
          {t('opsFix.inv.filterProduct')}
        </Chip>
        <Chip active={lowOnly} danger onClick={() => setLowOnly((v) => !v)}>
          <Warning size={12} weight="fill" /> {t('opsFix.inv.filterLow')} · {lowCount}
        </Chip>
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashboard.inventory.noDepots')} icon={<Package size={40} weight="fill" />}>
          {t('dashboard.inventory.noDepotsBody')}
        </CenterState>
      ) : lines.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : lines.error ? (
        <ErrorState message={lines.error} onRetry={lines.reload} />
      ) : // The ledger is depot-wide, so it must not hang off the stock filters: filtering
      // down to a type with no lines used to hide a depot's entire movement history.
      view === 'movements' ? (
        scopedId ? (
          <DepotMovementLedger depotId={scopedId} />
        ) : (
          <CenterState title={t('dashboard.inventory.noDepots')} icon={<Package size={40} weight="fill" />}>
            {t('dashboard.inventory.noDepotsBody')}
          </CenterState>
        )
      ) : visible.length === 0 ? (
        <CenterState title={t('dashboard.inventory.noLines')} icon={<Package size={40} weight="fill" />}>
          {lowOnly ? t('dashboard.inventory.noLinesLow') : t('dashboard.inventory.noLinesAll')}
        </CenterState>
      ) : (
        <>
          {canWrite && picker && (
            <Card className="flex flex-col gap-2 p-4">
              <p className="text-sm font-semibold">{t('opsFix.inv.pickLine')}</p>
              <div className="flex flex-col divide-y divide-[color:var(--border)]">
                {visible.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => pickLine(i.id)}
                    className="flex items-center justify-between gap-3 py-2 text-left text-sm hover:text-brand-700"
                  >
                    <span className="min-w-0 truncate font-medium">{i.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {i.quantity} {i.unit}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setPicker(false)}>
                  {t('opsFix.inv.cancel')}
                </Button>
              </div>
            </Card>
          )}
          {canWrite && opnameOpen && (
            <OpnameSheet items={visible} onClose={() => setOpnameOpen(false)} onDone={lines.reload} />
          )}
          <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div
                className={`${ROW_COLS} border-b border-app bg-[color:var(--surface-soft)] py-2.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]`}
              >
                <span>{t('opsFix.inv.colItem')}</span>
                <span className="text-right">{t('opsFix.inv.colQty')}</span>
                <span className="text-right">{t('opsFix.inv.colReserved')}</span>
                <span className="text-right">{t('opsFix.inv.colAvailable')}</span>
                <span className="text-right">{t('opsFix.inv.colMin')}</span>
                <span className="text-right">{t('opsFix.inv.colActions')}</span>
              </div>
              <div className="divide-y divide-[color:var(--border)]">
                {visible.map((item) => (
                  <StockRow
                    key={item.id}
                    item={item}
                    canWrite={canWrite}
                    expanded={expandedId === item.id}
                    entry={entry}
                    price={priceOf(item)}
                    onOpen={(mode, receipt) => openRow(item.id, mode, receipt)}
                    onChanged={lines.reload}
                  />
                ))}
              </div>
            </div>
          </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewInventory(customer?.role)) {
    return (
      <CenterState title={t('dashboard.inventory.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashboard.inventory.gateBody')}
      </CenterState>
    );
  }
  return <InventoryBody />;
}

export default function InventoryPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
