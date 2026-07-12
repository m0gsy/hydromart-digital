'use client';

import { useState } from 'react';
import { Crosshair, MapPin, PencilSimple, Plus, Star, Trash, X } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { ConfirmDialog, Sheet } from '@/components/overlay';
import { Button, Card, Chip, ErrorState, Field, Input, Skeleton } from '@/components/ui';
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
  const [pendingDelete, setPendingDelete] = useState<Address | null>(null);

  const set = (k: keyof AddressBookForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setCoords = (lat: number, lng: number) =>
    setForm((f) => ({ ...f, latitude: String(lat), longitude: String(lng) }));
  const clearPin = () => setForm((f) => ({ ...f, latitude: '', longitude: '' }));

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
      setFormError(err instanceof ApiError ? err.message : 'Gagal menyimpan alamat.');
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

  const setPrimary = (id: string) =>
    act(id, () => api.post(endpoints.addresses.primary(id), undefined, true));

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    await act(id, () => api.del(endpoints.addresses.detail(id), true));
    setPendingDelete(null);
  }

  if (loading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const list = addresses ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[30px] font-extrabold tracking-tight">Alamat saya</h1>
        <Button type="button" onClick={openCreate} className="rounded-full">
          <Plus size={17} weight="bold" />
          Tambah alamat
        </Button>
      </div>

      {list.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          Belum ada alamat tersimpan. Tambahkan satu agar checkout berikutnya lebih cepat.
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((a) => {
            const pinned = a.latitude !== null && a.longitude !== null;
            const rowBusy = busyId === a.id;
            return (
              <div key={a.id} className="surface flex flex-col gap-2.5 rounded-2xl p-5 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-bold">{a.label}</span>
                  {a.isPrimary && (
                    <Chip tone="tint">
                      <Star size={12} weight="fill" />
                      Utama
                    </Chip>
                  )}
                  {pinned && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
                      <MapPin size={13} weight="fill" className="text-brand-500" />
                      Tersemat
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium">
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
                      loading={rowBusy}
                      className="rounded-full px-3.5 py-1.5 text-[13px]"
                    >
                      <Star size={14} />
                      Jadikan utama
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openEdit(a)}
                    className="rounded-full px-3.5 py-1.5 text-[13px]"
                  >
                    <PencilSimple size={14} />
                    Ubah
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPendingDelete(a)}
                    disabled={rowBusy}
                    className="rounded-full px-3.5 py-1.5 text-[13px] text-[color:var(--danger)] hover:bg-[color:var(--danger-bg)]"
                  >
                    <Trash size={14} />
                    Hapus
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Alamat baru' : 'Ubah alamat'}
      >
        <AddressForm
          form={form}
          set={set}
          setCoords={setCoords}
          clearPin={clearPin}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
          saving={saving}
          error={formError}
        />
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Hapus alamat?"
        message={
          pendingDelete
            ? `Alamat "${pendingDelete.label}" akan dihapus permanen.`
            : ''
        }
        confirmLabel="Hapus"
        tone="danger"
        loading={pendingDelete ? busyId === pendingDelete.id : false}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function AddressForm({
  form,
  set,
  setCoords,
  clearPin,
  onSubmit,
  onCancel,
  saving,
  error,
}: {
  form: AddressBookForm;
  set: (k: keyof AddressBookForm) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  setCoords: (lat: number, lng: number) => void;
  clearPin: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [locating, setLocating] = useState(false);
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const pinned = form.latitude.trim() !== '' && form.longitude.trim() !== '';

  function locate() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoHint('Perangkat ini tidak mendukung lokasi otomatis. Masukkan koordinat manual.');
      return;
    }
    setGeoHint(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => {
        setGeoHint('Tidak bisa mengambil lokasi. Izinkan akses lokasi atau isi manual.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" htmlFor="label" hint="mis. Rumah, Kantor">
          <Input id="label" required value={form.label} onChange={set('label')} maxLength={50} />
        </Field>
        <Field label="Nama penerima" htmlFor="recipientName">
          <Input id="recipientName" required value={form.recipientName} onChange={set('recipientName')} />
        </Field>
      </div>
      <Field label="Nomor telepon" htmlFor="phone">
        <Input id="phone" required value={form.phone} onChange={set('phone')} inputMode="tel" />
      </Field>
      <Field label="Alamat" htmlFor="addressLine">
        <Input
          id="addressLine"
          required
          value={form.addressLine}
          onChange={set('addressLine')}
          placeholder="Jalan, nomor, RT/RW"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Kota" htmlFor="city">
          <Input id="city" required value={form.city} onChange={set('city')} />
        </Field>
        <Field label="Provinsi" htmlFor="province">
          <Input id="province" required value={form.province} onChange={set('province')} />
        </Field>
        <Field label="Kode pos" htmlFor="postalCode" hint="Opsional">
          <Input id="postalCode" value={form.postalCode} onChange={set('postalCode')} inputMode="numeric" />
        </Field>
      </div>

      {/* Pin picker over raw lat/lng — coords stay optional and flow through toAddressPayload. */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-app bg-[color:var(--surface-soft)] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MapPin size={16} weight="fill" className="text-brand-600" />
          Titik lokasi antar
          <span className="text-xs font-normal text-muted">(opsional)</span>
        </div>
        {pinned ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--success)]">
              Lokasi tersemat ✓
              <span className="font-mono text-xs text-muted">
                ({Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)})
              </span>
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={clearPin}
              className="rounded-full px-3 py-1.5 text-[13px]"
            >
              <X size={14} />
              Hapus pin
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={locate}
            loading={locating}
            className="w-full rounded-full sm:w-auto"
          >
            <Crosshair size={16} />
            Gunakan lokasi saya
          </Button>
        )}
        {geoHint && <p className="text-xs text-muted">{geoHint}</p>}

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="self-start text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          {showAdvanced ? 'Sembunyikan koordinat manual' : 'Masukkan koordinat manual'}
        </button>
        {showAdvanced && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitude" htmlFor="latitude" hint="-90 s/d 90">
              <Input id="latitude" value={form.latitude} onChange={set('latitude')} inputMode="decimal" placeholder="-6.9147" />
            </Field>
            <Field label="Longitude" htmlFor="longitude" hint="-180 s/d 180">
              <Input id="longitude" value={form.longitude} onChange={set('longitude')} inputMode="decimal" placeholder="107.6098" />
            </Field>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={saving} className="rounded-full">
          Simpan
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="rounded-full">
          Batal
        </Button>
      </div>
    </form>
  );
}

export default function AddressesPage() {
  return (
    <RequireAuth>
      <AddressesInner />
    </RequireAuth>
  );
}
