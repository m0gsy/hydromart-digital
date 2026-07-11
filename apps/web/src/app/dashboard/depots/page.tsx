'use client';

import { useState } from 'react';
import { Buildings, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { EMPTY_DEPOT_FORM, toDepotPayload, type DepotForm } from '@/lib/depots';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canManageDepots } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin, Page } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

function formFromDepot(d: DepotAdmin): DepotForm {
  return {
    code: d.code,
    name: d.name,
    ownershipType: d.ownershipType,
    address: d.address,
    city: d.city,
    province: d.province,
    lat: String(d.lat),
    lng: String(d.lng),
    serviceRadiusKm: String(d.serviceRadiusKm),
    deliveryFee: String(d.deliveryFee),
    minOrderAmount: d.minOrderAmount == null ? '' : String(d.minOrderAmount),
  };
}

/** Create (depot=null) or edit form. Hours/holidays are omitted — see page ceiling note. */
function DepotEditor({ depot, onDone, onCancel }: { depot: DepotAdmin | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<DepotForm>(depot ? formFromDepot(depot) : EMPTY_DEPOT_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof DepotForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    const parsed = toDepotPayload(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (depot) await api.patch(endpoints.depots.detail(depot.id), parsed.value, true);
      else await api.post(endpoints.depots.create, parsed.value, true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the depot.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{depot ? `Edit ${depot.name}` : 'New depot'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor="d-code">
          <Input id="d-code" value={form.code} onChange={set('code')} placeholder="JKT-01" />
        </Field>
        <Field label="Name" htmlFor="d-name">
          <Input id="d-name" value={form.name} onChange={set('name')} placeholder="Depot Cikini" />
        </Field>
        <Field label="Ownership" htmlFor="d-own">
          <select id="d-own" value={form.ownershipType} onChange={set('ownershipType')} className={inputClass}>
            <option value="HKP">HKP</option>
            <option value="WARALABA">WARALABA</option>
          </select>
        </Field>
        <Field label="City" htmlFor="d-city">
          <Input id="d-city" value={form.city} onChange={set('city')} placeholder="Jakarta Pusat" />
        </Field>
        <Field label="Province" htmlFor="d-prov">
          <Input id="d-prov" value={form.province} onChange={set('province')} placeholder="DKI Jakarta" />
        </Field>
        <Field label="Address" htmlFor="d-addr">
          <Input id="d-addr" value={form.address} onChange={set('address')} placeholder="Jl. Cikini Raya No. 1" />
        </Field>
        <Field label="Latitude" htmlFor="d-lat">
          <Input id="d-lat" inputMode="decimal" value={form.lat} onChange={set('lat')} placeholder="-6.1944" />
        </Field>
        <Field label="Longitude" htmlFor="d-lng">
          <Input id="d-lng" inputMode="decimal" value={form.lng} onChange={set('lng')} placeholder="106.8412" />
        </Field>
        <Field label="Service radius (km)" htmlFor="d-rad" hint="Blank = default 5 km">
          <Input id="d-rad" inputMode="decimal" value={form.serviceRadiusKm} onChange={set('serviceRadiusKm')} placeholder="5" />
        </Field>
        <Field label="Delivery fee (IDR)" htmlFor="d-fee">
          <Input id="d-fee" inputMode="numeric" value={form.deliveryFee} onChange={set('deliveryFee')} placeholder="5000" />
        </Field>
        <Field label="Min order (IDR)" htmlFor="d-min" hint="Blank = no minimum">
          <Input id="d-min" inputMode="numeric" value={form.minOrderAmount} onChange={set('minOrderAmount')} placeholder="20000" />
        </Field>
      </div>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} loading={busy}>
          {depot ? 'Save changes' : 'Create depot'}
        </Button>
      </div>
    </Card>
  );
}

function DepotCard({ depot, onEdit, onChanged }: { depot: DepotAdmin; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      if (depot.active) await api.del(endpoints.depots.detail(depot.id), true);
      else await api.patch(endpoints.depots.detail(depot.id), { active: true }, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the depot.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{depot.name}</p>
          <p className="text-xs text-muted">
            {depot.code} · {depot.city} · {depot.ownershipType}
          </p>
        </div>
        <Badge tone={depot.active ? 'success' : 'neutral'}>{depot.active ? 'Active' : 'Inactive'}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">Radius</dt>
          <dd className="font-semibold tabular-nums">{depot.serviceRadiusKm} km</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Delivery</dt>
          <dd className="font-semibold"><Money amount={depot.deliveryFee} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Min order</dt>
          <dd className="font-semibold">{depot.minOrderAmount == null ? '—' : <Money amount={depot.minOrderAmount} />}</dd>
        </div>
      </dl>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-app pt-2">
        <Button variant="secondary" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        <Button variant={depot.active ? 'danger' : 'primary'} onClick={toggleActive} loading={busy}>
          {depot.active ? 'Deactivate' : 'Reactivate'}
        </Button>
      </div>
    </Card>
  );
}

function DepotsBody() {
  const [editing, setEditing] = useState<DepotAdmin | null | 'new'>(null);
  const list = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));
  const items = list.data?.items ?? [];

  function closeForm() {
    setEditing(null);
    list.reload();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Buildings size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Depots</h1>
        </div>
        {editing === null && <Button onClick={() => setEditing('new')}>New depot</Button>}
      </div>

      {editing !== null && (
        <DepotEditor
          key={editing === 'new' ? 'new' : editing.id}
          depot={editing === 'new' ? null : editing}
          onDone={closeForm}
          onCancel={() => setEditing(null)}
        />
      )}

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title="No depots yet" icon={<Buildings size={40} weight="fill" />}>
          Create the first depot to start serving orders.
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((d) => (
            <DepotCard key={d.id} depot={d} onEdit={() => setEditing(d)} onChanged={list.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canManageDepots(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        Depot management is available to depot managers and head office.
      </CenterState>
    );
  }
  return <DepotsBody />;
}

export default function DepotsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
