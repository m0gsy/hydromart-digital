'use client';

import { useState } from 'react';
import { ClipboardText, Lock, Package, Plus, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canViewInventory, canWriteInventory } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { InventoryItem, StockMovement, StockMovementType } from '@/lib/types';

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  RECEIPT: 'Stok masuk',
  ADJUSTMENT: 'Penyesuaian',
  OPNAME: 'Opname',
  SALE: 'Terjual',
};

/** Read-only movement ledger for one line — opname/adjust/sale/restock history (10b). */
function MovementLog({ item }: { item: InventoryItem }) {
  const log = useAsync<StockMovement[]>(() => api.get(endpoints.inventory.movements(item.id), true), [item.id]);

  if (log.loading) return <Skeleton className="h-24 w-full" />;
  if (log.error) return <ErrorState message={log.error} onRetry={log.reload} />;
  if (!log.data || log.data.length === 0)
    return <p className="py-2 text-sm text-muted">Belum ada pergerakan stok.</p>;

  return (
    <ul className="flex flex-col gap-1.5">
      {log.data.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <span className="font-medium">{MOVEMENT_LABEL[m.type] ?? m.type}</span>
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

type ActionMode = 'none' | 'adjust' | 'opname' | 'price';

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
  const isProduk = item.itemType === 'PRODUK';
  const [mode, setMode] = useState<ActionMode>(initialMode);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: ActionMode) {
    setMode(next);
    setValue(next === 'price' && item.sellPrice != null ? String(item.sellPrice) : '');
    setReason('');
    setError(null);
  }

  // sellPrice = null clears the override (back to catalog base).
  async function savePrice(clear: boolean) {
    const parsed = clear ? null : num(value);
    if (!clear && (parsed === null || parsed < 0)) {
      setError('Isi harga 0 atau lebih, atau hapus override.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.inventory.update(item.id), { sellPrice: parsed }, true);
      setMode('none');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memperbarui harga.');
    } finally {
      setBusy(false);
    }
  }

  async function submitStock() {
    const parsed = num(value);
    if (parsed === null) {
      setError(mode === 'adjust' ? 'Isi angka bulat (boleh negatif).' : 'Isi jumlah 0 atau lebih.');
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
      setError(err instanceof ApiError ? err.message : 'Gagal memperbarui stok.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'none') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => open('adjust')}>
          Sesuaikan
        </Button>
        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => open('opname')}>
          Opname
        </Button>
        {isProduk && (
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => open('price')}>
            Harga
          </Button>
        )}
      </div>
    );
  }

  if (mode === 'price') {
    return (
      <div className="flex flex-col gap-2">
        <Field
          label="Override harga jual (IDR)"
          htmlFor={`p-${item.id}`}
          hint="Kosongkan + Hapus untuk kembali ke harga katalog."
        >
          <Input
            id={`p-${item.id}`}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="mis. 22000"
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
            Batal
          </Button>
          {item.sellPrice != null && (
            <Button variant="danger" onClick={() => savePrice(true)} loading={busy}>
              Hapus override
            </Button>
          )}
          <Button onClick={() => savePrice(false)} loading={busy}>
            Simpan harga
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
            ? `Jumlah ${item.unit} hasil opname`
            : isReceipt
              ? `Terima ${item.unit} (mis. 10)`
              : `Sesuaikan ${item.unit} (bertanda, mis. -5)`
        }
        htmlFor={`v-${item.id}`}
      >
        <Input
          id={`v-${item.id}`}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'opname' ? `saat ini ${item.quantity}` : isReceipt ? 'mis. 10' : 'mis. -5 atau 10'}
          autoFocus
        />
      </Field>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan (opsional)" />
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setMode('none')} disabled={busy}>
          Batal
        </Button>
        <Button onClick={submitStock} loading={busy}>
          {mode === 'opname' ? 'Simpan opname' : isReceipt ? 'Terima stok' : 'Simpan penyesuaian'}
        </Button>
      </div>
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
  onOpen,
  onChanged,
}: {
  item: InventoryItem;
  canWrite: boolean;
  expanded: boolean;
  entry: Entry;
  onOpen: (mode: ActionMode, receipt: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <div className={item.lowStock ? 'bg-[color:var(--danger-bg)]' : undefined}>
      <div className={`${ROW_COLS} py-2.5`}>
        <button
          type="button"
          onClick={() => onOpen('none', false)}
          className="flex min-w-0 items-center gap-2 text-left"
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
                Terima
              </Button>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onOpen('adjust', false)}>
                Sesuaikan
              </Button>
            </>
          ) : (
            <span className="text-xs text-[color:var(--text-muted)]">Hanya lihat</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-app bg-[color:var(--surface-soft)] px-3 py-3">
          {item.itemType === 'PRODUK' && (
            <p className="text-xs text-muted">
              Harga:{' '}
              {item.sellPrice != null ? (
                <Money amount={item.sellPrice} className="font-semibold" />
              ) : (
                <span className="font-medium">harga katalog</span>
              )}
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
          <div className="border-t border-app pt-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Riwayat stok
            </p>
            <MovementLog item={item} />
          </div>
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
  const base = 'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors';
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

function InventoryBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const canWrite = canWriteInventory(customer?.role);
  const { scopedId, selected, depots, ready } = useDepot();
  const [lowOnly, setLowOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry>({ mode: 'none', receipt: false });

  const lines = useAsync<InventoryItem[]>(
    () => (scopedId ? api.get(endpoints.inventory.lines(scopedId, { lowStockOnly: lowOnly }), true) : Promise.resolve([])),
    [scopedId, lowOnly],
  );

  // The depot label — the selected depot, or the first when "All" is active.
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  const all = lines.data ?? [];
  const visible = all.filter((i) =>
    typeFilter === 'all' ? true : typeFilter === 'produk' ? i.itemType === 'PRODUK' : i.itemType !== 'PRODUK',
  );
  const lowCount = all.filter((i) => i.lowStock).length;

  // Toggle a row's inline detail; re-clicking the same mode/receipt collapses it.
  function openRow(id: string, mode: ActionMode, receipt: boolean) {
    if (expandedId === id && entry.mode === mode && entry.receipt === receipt) {
      setExpandedId(null);
      return;
    }
    setEntry({ mode, receipt });
    setExpandedId(id);
  }

  // ponytail: header buttons act on the first visible line — stock ops are per-line,
  // there is no depot-wide receive/opname endpoint. Add a line picker if that changes.
  function headerOpen(mode: ActionMode, receipt: boolean) {
    const first = visible[0];
    if (first) openRow(first.id, mode, receipt);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Inventory</h1>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button className="bg-brand-600" disabled={visible.length === 0} onClick={() => headerOpen('adjust', true)}>
              <Plus size={16} weight="bold" /> Terima stok
            </Button>
            <Button
              variant="secondary"
              disabled={visible.length === 0}
              onClick={() => headerOpen('opname', false)}
            >
              <ClipboardText size={16} /> Opname
            </Button>
          </div>
        )}
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          Menampilkan stok untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher).
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
          Semua
        </Chip>
        <Chip active={typeFilter === 'bahan'} onClick={() => setTypeFilter('bahan')}>
          Bahan baku
        </Chip>
        <Chip active={typeFilter === 'produk'} onClick={() => setTypeFilter('produk')}>
          Produk
        </Chip>
        <Chip active={lowOnly} danger onClick={() => setLowOnly((v) => !v)}>
          <Warning size={12} weight="fill" /> Stok menipis · {lowCount}
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
      ) : visible.length === 0 ? (
        <CenterState title={t('dashboard.inventory.noLines')} icon={<Package size={40} weight="fill" />}>
          {lowOnly ? t('dashboard.inventory.noLinesLow') : t('dashboard.inventory.noLinesAll')}
        </CenterState>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div
                className={`${ROW_COLS} border-b border-app bg-[color:var(--surface-soft)] py-2.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]`}
              >
                <span>Item</span>
                <span className="text-right">Stok</span>
                <span className="text-right">Dipesan</span>
                <span className="text-right">Tersedia</span>
                <span className="text-right">Min</span>
                <span className="text-right">Aksi</span>
              </div>
              <div className="divide-y divide-[color:var(--border)]">
                {visible.map((item) => (
                  <StockRow
                    key={item.id}
                    item={item}
                    canWrite={canWrite}
                    expanded={expandedId === item.id}
                    entry={entry}
                    onOpen={(mode, receipt) => openRow(item.id, mode, receipt)}
                    onChanged={lines.reload}
                  />
                ))}
              </div>
            </div>
          </div>
        </Card>
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
