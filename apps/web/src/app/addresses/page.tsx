'use client';

import { useState } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  AddressBookForm,
  EMPTY_ADDRESS_FORM,
  addressToBookForm,
  toAddressPayload,
} from '@/lib/addresses';
import { useAsync } from '@/lib/use-async';
import type { Address } from '@/lib/types';

function AddressesInner() {
  const { data: addresses, error, loading, reload } = useAsync<Address[]>(() =>
    api.get(endpoints.addresses.list, true),
  );

  // `editing`: 'new' shows the create form, an id shows that row's edit form, null hides it.
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<AddressBookForm>(EMPTY_ADDRESS_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const set = (k: keyof AddressBookForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function openCreate() {
    setForm(EMPTY_ADDRESS_FORM);
    setFormError(null);
    setEditing('new');
  }

  function openEdit(a: Address) {
    setForm(addressToBookForm(a));
    setFormError(null);
    setEditing(a.id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = toAddressPayload(form);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api.post(endpoints.addresses.create, result.value, true);
      } else if (editing) {
        await api.patch(endpoints.addresses.detail(editing), result.value, true);
      }
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save the address.');
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      reload();
    } catch {
      /* a failed row action leaves the list unchanged; the reload reflects reality */
    } finally {
      setBusyId(null);
    }
  }

  const setPrimary = (id: string) => act(id, () => api.post(endpoints.addresses.primary(id), undefined, true));
  const remove = (id: string) => {
    if (!window.confirm('Delete this address?')) return;
    void act(id, () => api.del(endpoints.addresses.detail(id), true));
  };

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const list = addresses ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My addresses</h1>
        {editing === null && (
          <Button type="button" onClick={openCreate}>
            Add address
          </Button>
        )}
      </div>

      {list.length === 0 && editing === null && (
        <Card className="p-4 text-sm text-muted">
          You have no saved addresses yet. Add one to check out faster next time.
        </Card>
      )}

      {editing === 'new' && (
        <AddressForm
          form={form}
          set={set}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
          saving={saving}
          error={formError}
          title="New address"
        />
      )}

      <div className="flex flex-col gap-3">
        {list.map((a) =>
          editing === a.id ? (
            <AddressForm
              key={a.id}
              form={form}
              set={set}
              onSubmit={submit}
              onCancel={() => setEditing(null)}
              saving={saving}
              error={formError}
              title="Edit address"
            />
          ) : (
            <Card key={a.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{a.label}</span>
                {a.isPrimary && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    Primary
                  </span>
                )}
                {a.latitude !== null && a.longitude !== null && (
                  <span className="text-xs text-muted">· pinned</span>
                )}
              </div>
              <p className="text-sm">
                {a.recipientName} · {a.phone}
              </p>
              <p className="text-sm text-muted">
                {a.addressLine}, {a.city}, {a.province}
                {a.postalCode ? ` ${a.postalCode}` : ''}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {!a.isPrimary && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPrimary(a.id)}
                    loading={busyId === a.id}
                  >
                    Set primary
                  </Button>
                )}
                <Button type="button" variant="secondary" onClick={() => openEdit(a)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => remove(a.id)}
                  loading={busyId === a.id}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}

function AddressForm({
  form,
  set,
  onSubmit,
  onCancel,
  saving,
  error,
  title,
}: {
  form: AddressBookForm;
  set: (k: keyof AddressBookForm) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  title: string;
}) {
  return (
    <Card className="p-0">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4">
        <h2 className="font-semibold">{title}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label" htmlFor="label" hint="e.g. Home, Office">
            <Input id="label" required value={form.label} onChange={set('label')} maxLength={50} />
          </Field>
          <Field label="Recipient name" htmlFor="recipientName">
            <Input id="recipientName" required value={form.recipientName} onChange={set('recipientName')} />
          </Field>
        </div>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" required value={form.phone} onChange={set('phone')} inputMode="tel" />
        </Field>
        <Field label="Address" htmlFor="addressLine">
          <Input id="addressLine" required value={form.addressLine} onChange={set('addressLine')} placeholder="Street, number, RT/RW" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="city">
            <Input id="city" required value={form.city} onChange={set('city')} />
          </Field>
          <Field label="Province" htmlFor="province">
            <Input id="province" required value={form.province} onChange={set('province')} />
          </Field>
          <Field label="Postal code" htmlFor="postalCode" hint="Optional">
            <Input id="postalCode" value={form.postalCode} onChange={set('postalCode')} inputMode="numeric" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" htmlFor="latitude" hint="Optional — enables depot delivery">
            <Input id="latitude" value={form.latitude} onChange={set('latitude')} inputMode="decimal" placeholder="-6.9147" />
          </Field>
          <Field label="Longitude" htmlFor="longitude" hint="Optional">
            <Input id="longitude" value={form.longitude} onChange={set('longitude')} inputMode="decimal" placeholder="107.6098" />
          </Field>
        </div>
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={saving}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function AddressesPage() {
  return (
    <RequireAuth>
      <AddressesInner />
    </RequireAuth>
  );
}
