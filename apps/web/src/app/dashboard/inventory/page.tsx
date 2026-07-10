'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Lock, Package, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canViewInventory, canWriteInventory } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Depot, InventoryItem, Page } from '@/lib/types';

// Depot-service returns the full record; we only need these fields for the picker.
type DepotOption = Depot & Record<string, unknown>;

function num(v: string): number | null {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** Inline adjust / opname forms for one stock line. Reload the list on success. */
function LineActions({ item, onChanged }: { item: InventoryItem; onChanged: () => void }) {
  const [mode, setMode] = useState<'none' | 'adjust' | 'opname'>('none');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: 'adjust' | 'opname') {
    setMode(next);
    setValue('');
    setReason('');
    setError(null);
  }

  async function submit() {
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
      <div className="flex gap-2 border-t border-app pt-2">
        <Button variant="secondary" onClick={() => open('adjust')}>
          Adjust
        </Button>
        <Button variant="ghost" onClick={() => open('opname')}>
          Count
        </Button>
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
        <Button onClick={submit} loading={busy}>
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
      {canWrite && <LineActions item={item} onChanged={onChanged} />}
    </Card>
  );
}

function InventoryBody() {
  const { customer } = useAuth();
  const canWrite = canWriteInventory(customer?.role);
  const [depotId, setDepotId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const depots = useAsync<Page<DepotOption>>(() => api.get(endpoints.depots.browse({ limit: 100 }), true));
  const options = depots.data?.items ?? [];

  // Default to the first depot once the list loads. Keyed on the stable loaded
  // data (not the per-render `options` array) to avoid re-running every render.
  useEffect(() => {
    const first = depots.data?.items?.[0];
    if (!depotId && first) setDepotId(first.id);
  }, [depotId, depots.data]);

  const lines = useAsync<InventoryItem[]>(
    () => (depotId ? api.get(endpoints.inventory.lines(depotId, { lowStockOnly: lowOnly }), true) : Promise.resolve([])),
    [depotId, lowOnly],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Inventory</h1>
        </div>
        <Link href="/dashboard/orders" className="text-sm font-semibold text-brand-700 hover:underline">
          Order queue →
        </Link>
      </div>

      {depots.loading ? (
        <Skeleton className="h-11 w-full" />
      ) : depots.error ? (
        <ErrorState message={depots.error} onRetry={depots.reload} />
      ) : options.length === 0 ? (
        <CenterState title="No depots" icon={<Package size={40} weight="fill" />}>
          No depots are configured yet.
        </CenterState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Depot" htmlFor="depot">
              <select
                id="depot"
                value={depotId}
                onChange={(e) => setDepotId(e.target.value)}
                className="surface-elevated w-full min-w-56 rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
              >
                {options.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.city}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex cursor-pointer items-center gap-2 py-2.5 text-sm font-medium">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Low stock only
            </label>
          </div>

          {lines.loading ? (
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
        </>
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
