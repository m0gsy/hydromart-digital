'use client';

import { useState } from 'react';
import { Lock, Package, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canViewInventory, canWriteInventory } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { InventoryItem } from '@/lib/types';

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

type ActionMode = 'none' | 'adjust' | 'opname' | 'price';

/** Inline adjust / opname / price forms for one stock line. Reload the list on success. */
function LineActions({ item, onChanged }: { item: InventoryItem; onChanged: () => void }) {
  const isProduk = item.itemType === 'PRODUK';
  const [mode, setMode] = useState<ActionMode>('none');
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
      setError('Enter a price of 0 or more, or clear the override.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.inventory.update(item.id), { sellPrice: parsed }, true);
      setMode('none');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the price.');
    } finally {
      setBusy(false);
    }
  }

  async function submitStock() {
    const parsed = num(value);
    if (parsed === null) {
      setError(mode === 'adjust' ? 'Enter a whole number (may be negative).' : 'Enter a count of 0 or more.');
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
      setError(err instanceof ApiError ? err.message : 'Could not update stock.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'none') {
    return (
      <div className="flex flex-wrap gap-2 border-t border-app pt-2">
        <Button variant="secondary" onClick={() => open('adjust')}>
          Adjust
        </Button>
        <Button variant="ghost" onClick={() => open('opname')}>
          Count
        </Button>
        {isProduk && (
          <Button variant="ghost" onClick={() => open('price')}>
            Price
          </Button>
        )}
      </div>
    );
  }

  if (mode === 'price') {
    return (
      <div className="flex flex-col gap-2 border-t border-app pt-2">
        <Field label="Per-depot price override (IDR)" htmlFor={`p-${item.id}`} hint="Blank + Clear reverts to the catalog base price.">
          <Input
            id={`p-${item.id}`}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 22000"
            autoFocus
          />
        </Field>
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setMode('none')} disabled={busy}>
            Cancel
          </Button>
          {item.sellPrice != null && (
            <Button variant="danger" onClick={() => savePrice(true)} loading={busy}>
              Clear override
            </Button>
          )}
          <Button onClick={() => savePrice(false)} loading={busy}>
            Save price
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-app pt-2">
      <Field
        label={mode === 'adjust' ? `Adjust ${item.unit} (signed, e.g. -5)` : `Counted ${item.unit} (opname)`}
        htmlFor={`v-${item.id}`}
      >
        <Input
          id={`v-${item.id}`}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'adjust' ? 'e.g. -5 or 10' : `current ${item.quantity}`}
          autoFocus
        />
      </Field>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setMode('none')} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submitStock} loading={busy}>
          {mode === 'adjust' ? 'Apply adjustment' : 'Save count'}
        </Button>
      </div>
    </div>
  );
}

function LineCard({ item, canWrite, onChanged }: { item: InventoryItem; canWrite: boolean; onChanged: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{item.label}</p>
          <p className="text-xs text-muted">{item.itemType}</p>
        </div>
        {item.lowStock && (
          <Badge tone="warning">
            <Warning size={12} weight="fill" className="mr-1" />
            Low
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-4 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">On hand</dt>
          <dd className="font-semibold tabular-nums">{item.quantity}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Reserved</dt>
          <dd className="font-semibold tabular-nums">{item.reserved}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Available</dt>
          <dd className={`font-semibold tabular-nums ${item.lowStock ? 'text-amber-700' : ''}`}>
            {item.available}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Min</dt>
          <dd className="font-semibold tabular-nums">{item.minimumStock || '—'}</dd>
        </div>
      </dl>
      {item.itemType === 'PRODUK' && (
        <p className="text-xs text-muted">
          Price:{' '}
          {item.sellPrice != null ? (
            <Money amount={item.sellPrice} className="font-semibold" />
          ) : (
            <span className="font-medium">catalog base</span>
          )}
        </p>
      )}
      {canWrite && <LineActions item={item} onChanged={onChanged} />}
    </Card>
  );
}

function InventoryBody() {
  const { customer } = useAuth();
  const canWrite = canWriteInventory(customer?.role);
  const { scopedId, selected, depots, ready } = useDepot();
  const [lowOnly, setLowOnly] = useState(false);

  const lines = useAsync<InventoryItem[]>(
    () => (scopedId ? api.get(endpoints.inventory.lines(scopedId, { lowStockOnly: lowOnly }), true) : Promise.resolve([])),
    [scopedId, lowOnly],
  );

  // The depot label — the selected depot, or the first when "All" is active.
  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Inventory</h1>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
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

      {ready && depots.length === 0 ? (
        <CenterState title="No depots" icon={<Package size={40} weight="fill" />}>
          No depots are configured yet.
        </CenterState>
      ) : lines.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : lines.error ? (
        <ErrorState message={lines.error} onRetry={lines.reload} />
      ) : !lines.data || lines.data.length === 0 ? (
        <CenterState title="No stock lines" icon={<Package size={40} weight="fill" />}>
          {lowOnly ? 'Nothing is below its minimum here.' : 'This depot has no stock lines yet.'}
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lines.data.map((item) => (
            <LineCard key={item.id} item={item} canWrite={canWrite} onChanged={lines.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewInventory(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        Inventory is available to depot staff and head office.
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
